from giraf.workflow import execute_workflow


def test_output_port_file_selection():
    for patterns, expected in [(['*B.fits'], ['b']), (['a[1].fits'], ['special']), ([], None), (['flatb.fits'], None)]:
        graph = {'nodes': [{'id': name, 'label': name, 'payload': {}} for name in ['a', 'b']], 'links': [dict(source='a', target='b', role='input', kind='image', multiple=True, sourceFiles=patterns)]}
        received = []
        def run(node, payload):
            received.append(payload)
            return dict(id=node['id'], state='completed', products=[dict(id='b', label='FlatB.fits', asset='image'), dict(id='v', label='FlatV.fits', asset='image'), dict(id='special', label='a[1].fits', asset='image')])
        result = execute_workflow(graph, run, lambda: False, lambda state: None)
        if expected is None:
            assert result['state'] == 'failed'
            assert len(received) == 1
        else:
            assert result['state'] == 'completed'
            assert received[1]['inputs']['input'] == expected
