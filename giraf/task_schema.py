"""Compile IRAF parameter metadata and optional source evidence into file ports.

The same analyzer is used for source-distributed extensions and to build the
versioned bundled schema cache. Source facts refine the parameter-derived schema; missing source never blocks
a node. External profiles are optional overrides for unusual task semantics.
"""
import re


def arguments(text):
    result=[]; depth=0; quoted=False; start=0
    for i,ch in enumerate(text):
        if ch=='"': quoted=not quoted
        if not quoted:
            if ch in '([': depth+=1
            elif ch in ')]': depth-=1
            elif ch==',' and depth==0: result.append(text[start:i].strip());start=i+1
    result.append(text[start:].strip())
    return result


def calls(source):
    # Preserve offsets while excluding strings and character literals from
    # syntax. Diagnostics can contain apparent calls and parentheses.
    syntax = re.sub(r'''"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*' ''',
                    lambda m: ' ' * len(m[0]), source, flags=re.X)
    for m in re.finditer(r'\b([A-Za-z_]\w*)\s*\(',syntax):
        i=m.end();start=i;depth=1
        while i<len(syntax) and depth:
            ch=syntax[i]
            if ch=='(':depth+=1
            elif ch==')':depth-=1
            i+=1
        if depth==0:yield m.start(),m.group(1).lower(),arguments(source[start:i-1])


def infer_profile(parameters, source):
    from .spp_schema import analyze_text
    return analyze_text(parameters, source)


def parameter_profile(parameters, preserve_plural=False):
    """Compile .par metadata into a node, with auditable semantic inference.

    IRAF has no input/output column. Match the *object described* by the prompt,
    not an occurrence of 'image' in an arbitrary string description. Source I/O
    evidence can refine these ports, but is never required to create a node.
    This is task-independent: there is no task-name registry here.
    """
    inputs, outputs, evidence = [], [], []
    for p in parameters:
        name, typ = p['name'], p['type']
        if name in ('mode', '$nargs') or p.get('choices') or typ == 'pset':
            continue
        prompt = p.get('prompt', '').lower().strip()
        # Terminal streams are settings, not files to select or stage.
        if p.get('default') in ('STDOUT', 'STDERR') and re.search(r'\blog file\b', prompt):
            continue
        # A list parameter is a stream of typed values. Cursor lists can use
        # command files; scalar cursors are cursor values, not file names.
        if typ.startswith('*'):
            if not p.get('prompt') and 'h' in p.get('mode', '') and not p.get('hasDefault'):
                continue  # No evidence that an unprompted scratch list is an input.
            base = typ[1:]
            item = dict(name=name, label=p.get('prompt') or name, kind='text',
                        multiple=False, required=p.get('required', False), listDirected=True,
                        valueType='cursor' if base in ('gcur', 'imcur') else 'list',
                        representation='command-file' if base in ('gcur', 'imcur') else 'value-file',
                        elementType=base)
            if item['valueType'] == 'cursor':
                item['cursorType'] = base
            inputs.append(item)
            evidence.append(dict(parameter=name, source='parameter-type', type=typ,
                                 direction='input', representation=item['representation']))
            continue
        if typ not in ('s', 'f'):
            continue
        # Reject metadata ABOUT an image/file, e.g. its title, dimensions,
        # coordinate system, data type, selection expression or format.
        if re.search(r'\b(titles?|formats?|types?|datatype|data type|file type|pixel type|dimensions?|sections?|units|system|expressions?|keyword|parameters|apertures|bands|beams|fields|columns|directory|directories|device)\b', prompt):
            # "Output images or directory" is still an image destination.
            if not re.match(r'^(?:the )?output images? or directory\b', prompt):
                continue
        if re.search(r'\b(?:image|mask)\s+(?:scaling|weights?|zero point|offsets?|shifts?|value)\b', prompt) or re.match(r'^integer offsets\b', prompt):
            continue
        lead = re.sub(r'^(?:optional\s+)?(?:the |a |an )?', '', prompt)
        lead = re.split(r'\(default\s*:', lead, maxsplit=1)[0]
        lead = re.sub(r'\((?!s\))[^)]*\)', '', lead)
        declared_list = bool(re.match(r'list of ', lead))
        lead = re.sub(r'^(?:list of |names? of (?:the )?)', '', lead)
        lead = re.split(r'\b(?:containing|corresponding|which|where|with|for|to be|in which)\b', lead, maxsplit=1)[0]
        noun = r'(?:images?|spectra|spectrum|masks?|files?|textfiles?|tables?|coordinates?|coords|photometry|sky|reference|operand|resultant|results?)\b'
        is_file = bool(re.match(r'(?:(?:input|output|reference|template|resultant|operand|in\/out|modified|new)\s+)*' + noun, lead))
        is_file = is_file or bool(re.search(r'\b(?:image|images|file|files|metacode)\b', lead)) or bool(re.match(r'(?:input|output)\b.*\bimages?\b', lead))
        is_file = is_file or bool(re.match(r'^output\b.*\bmasks?\b', lead))
        if not is_file:
            continue
        # f validates filenames but does not declare direction or data format.
        output = bool(re.match(r'(?:output|resultant|result|new)\b', lead))
        if not output and typ == 'f' and not prompt:
            output = bool(re.fullmatch(r'output\d*|result\d*', name))
        direction = 'outputs' if output else 'inputs'
        kind = 'metacode' if re.search(r'\b(?:metacode|gki)\b', lead) else 'binary' if re.search(r'\bbinary\b', lead) else 'mask' if re.search(r'\bmask(?:s)?\b', lead) else 'image' if re.search(r'\b(?:images?|spectra|spectrum)\b', lead) else 'text'
        multiple = bool(re.search(r'\b(?:images|spectra|files|lists|tables|textfiles)\b|\(s\)', lead)) or declared_list
        scalar = bool(re.search(r'\b(?:constants?|numerical)\b|\bor\s+(?:(?:a|an)\s+)?numbers?\b', prompt))
        item = dict(name=name, kind=kind, label=p.get('prompt') or name)
        if output:
            optional = 'h' in p.get('mode', '') and p.get('default') == ''
            mode = 'each' if multiple else 'single'
            item.update(mode=mode, optional=optional, default='' if optional else name + ('_' if multiple else file_extension(kind)))
            outputs.append(item)
        else:
            item.update(multiple=multiple, required=p.get('required', False) and not scalar)
            if scalar:
                item['scalar'] = True
            inputs.append(item)
        evidence.append(dict(parameter=name, source='parameter-prompt', prompt=p.get('prompt', ''), type=typ, direction=direction[:-1], kind=kind))
    # A plural output without a file driver still has a useful single call
    # form (for example a generator, or arithmetic with scalar operands).
    for slot in outputs:
        if not preserve_plural and slot['mode'] == 'each' and (not inputs or all(s.get('scalar') for s in inputs)):
            slot['mode'] = 'single'
            if not slot['optional']:
                slot['default'] = slot['name'] + file_extension(slot['kind'])
    return dict(profile=dict(inputs=inputs, outputs=outputs, fixed={}), evidence=evidence)


def node_profile(parameters, inferred=None):
    """Use parameter metadata everywhere; refine known roles with source facts."""
    generated = parameter_profile(parameters)
    profile = generated['profile']
    if inferred and inferred.get('profile'):
        source = inferred['profile']
        known = {p['name'] for direction in ('inputs', 'outputs') for p in source[direction]} | set(inferred.get('parameterControls', []))
        for direction in ('inputs', 'outputs'):
            by_name = {p['name']: p for p in profile[direction]}
            profile[direction] = [p for p in profile[direction] if p['name'] not in known]
            for slot in source[direction]:
                merged = dict(by_name.get(slot['name'], {}), **slot)
                if merged.get('scalar'):
                    merged['required'] = False
                profile[direction].append(merged)
            order = {p['name']: i for i, p in enumerate(parameters)}
            profile[direction].sort(key=lambda p: order[p['name']])
        generated['evidence'] += inferred.get('evidence', [])
        generated['sourceRoles'] = sorted(known)
    if inferred:
        for hint in inferred.get('hints', []):
            for slot in profile['outputs']:
                if slot['name'] == hint['name']:
                    slot.update(hint)
                    generated['evidence'] += [e for e in inferred.get('evidence', []) if e.get('parameter') == hint['name']]
    return generated


def internal_parameters(parameters, source):
    """Find hidden list scratch variables assigned before their first CL read.

    Neither the name 'list' nor the '*' type alone implies an input or a local.
    Only unprompted hidden lists with a visible first assignment are removed
    from public ports. Keep the parameter and evidence for inspection.
    """
    source = re.sub(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|#[^\n]*',
                    lambda m: '""' if not m[0].startswith('#') else '', source)
    body = re.split(r'\bbegin\b', source, maxsplit=1)[-1]
    result = []
    for p in parameters:
        if not p['type'].startswith('*') or 'h' not in p.get('mode', '') or p.get('prompt'):
            continue
        first = re.search(r'\b' + re.escape(p['name']) + r'\b', body)
        if first and re.match(r'\s*=(?!=)', body[first.end():]):
            result.append(p)
    return result


FILE_EXTENSIONS = {'image-list': '.list', 'image': '.fits', 'mask': '.pl', 'text': '.txt',
                   'metacode': '.gki', 'binary': '.bin'}


def file_extension(kind):
    return FILE_EXTENSIONS[kind]


def refine_help(generated, parameters, source):
    """Refine ports using each parameter's own IRAF help paragraph.

    Use the opening definition, not mentions of other tasks' inputs/outputs
    later in the paragraph. Preserve the original .par prompt as the UI label.
    """
    section = re.split(r'\.ih\s*\nPARAMETERS\s*\n', source, maxsplit=1)
    if len(section) != 2:
        return generated
    section = re.split(r'^\.ih\s*$', section[1], maxsplit=1, flags=re.M)[0]
    pars = {p['name']: p for p in parameters}
    profile = generated['profile']
    for match in re.finditer(r'^\.ls\s+(\w+)[^\n]*\n(.*?)(?=^\.l[se]\b|\Z)', section, re.M | re.S):
        name, paragraph = match.groups()
        p = pars.get(name)
        # Some installed help headings use a singular form of a plural .par name.
        if p is None and name + 's' in pars:
            name += 's'
            p = pars[name]
        if name in generated.get('sourceRoles', []):
            continue
        if not p or p['type'] not in ('s', 'f') or p.get('choices'):
            continue
        paragraph = re.sub(r'\\f[BRI]', '', paragraph)
        paragraph = re.sub(r'\s+', ' ', paragraph).strip()
        opening = re.split(r'\.\s', paragraph, maxsplit=1)[0]
        parsed = parameter_profile([dict(p, prompt=opening)], preserve_plural=True)['profile']
        old = next((s for d in ('inputs', 'outputs') for s in profile[d] if s['name'] == name), None)
        prefix = bool(re.search(r'\bprefixed to the image name\b', paragraph, re.I))
        direction = 'outputs' if prefix or parsed['outputs'] else 'inputs'
        candidates = parsed[direction]
        if prefix:
            candidates = [dict(name=name, kind='image', mode='each', naming='prefix',
                               optional='h' in p.get('mode', '') and p.get('default') == '',
                               default='' if p.get('default') == '' else name + '_')]
        if not candidates:
            continue
        slot = candidates[0]
        if old:
            if not re.search(r'\b(?:input|output|resultant)\b', opening.lower().split('containing')[0]):
                direction = next(d for d in ('inputs', 'outputs') if old in profile[d])
                if direction == 'outputs' and 'mode' not in slot:
                    slot = dict(old)
            # A generic mention of "file" does not erase a proven binary format.
            if slot['kind'] == 'text' and old['kind'] != 'text':
                slot['kind'] = old['kind']
            if old.get('naming'):
                slot['naming'] = old['naming']
        if direction == 'outputs':
            if (old and old.get('mode') == 'each') or re.search(r'one (?:output |subtracted )?(?:\w+ )?(?:image|file).*?(?:every|each) input image', paragraph, re.I):
                slot['mode'] = 'each'
            if slot['mode'] == 'each' and not slot.get('optional'):
                slot['default'] = name + '_'
        slot['label'] = p.get('prompt') or name
        for d in ('inputs', 'outputs'):
            profile[d] = [s for s in profile[d] if s['name'] != name]
        profile[direction].append(slot)
        generated['evidence'].append(dict(parameter=name, source='task-help',
                                         definition=opening, direction=direction[:-1],
                                         **({'naming': 'prefix'} if prefix else {})))
    order = {p['name']: i for i, p in enumerate(parameters)}
    for direction in ('inputs', 'outputs'):
        profile[direction].sort(key=lambda s: order[s['name']])
    return generated
