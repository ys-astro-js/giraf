"""Execution request shapes; IRAF-specific value rules remain in task validation."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


ParameterValue = str | bool | int | float


class RequestModel(BaseModel):
    model_config = ConfigDict(strict=True, extra='allow', allow_inf_nan=False)


class FilePolicy(RequestModel):
    mode: Literal['copy', 'direct'] = 'copy'
    backup: bool = True


class Output(RequestModel):
    name: str = ''


class Examination(RequestModel):
    x: ParameterValue | None = None
    y: ParameterValue | None = None
    key: str = ''
    parameters: dict[str, dict[str, ParameterValue]] = Field(default_factory=dict)


class Destination(RequestModel):
    path: str = ''
    conflict: Literal['number', 'overwrite'] = 'number'


class AlignmentBinding(RequestModel):
    reference: list[str] = Field(default_factory=list)
    input: list[str] = Field(default_factory=list)


class TaskRequest(RequestModel):
    task: str = ''
    backend: Literal['cl', 'pyraf'] = 'cl'
    parameters: dict[str, ParameterValue] = Field(default_factory=dict)
    inputs: dict[str, list[str]] = Field(default_factory=dict)
    parameterSets: dict[str, dict[str, ParameterValue]] = Field(default_factory=dict)
    ccdproc: dict[str, ParameterValue] = Field(default_factory=dict)
    ccdred: dict[str, ParameterValue] = Field(default_factory=dict)
    output: Output = Field(default_factory=Output)
    outputs: dict[str, str] = Field(default_factory=dict)
    expressions: dict[str, str] = Field(default_factory=dict)
    mapping: dict[str, str] = Field(default_factory=dict)
    exam: Examination = Field(default_factory=Examination)
    section: str = ''
    cursorCommands: dict[str, str] = Field(default_factory=dict)
    textInputs: dict[str, str] = Field(default_factory=dict)
    alignmentBinding: AlignmentBinding | None = None
    destination: Destination | None = None
    filePolicy: FilePolicy = Field(default_factory=FilePolicy)
    workingDirectory: str | None = None
    instanceId: str | None = None
    fileConfirmation: str | None = None


class WorkflowNode(RequestModel):
    id: str
    label: str
    payload: TaskRequest


class ReceiveMode(RequestModel):
    """How a connection crossing into a loop region receives (giraf/flows.py receive_mode)."""
    mode: Literal['all', 'match']
    keys: list[str] = Field(default_factory=list)


class WorkflowLink(RequestModel):
    source: str
    target: str
    role: str
    kind: str
    multiple: bool
    sourceFiles: list[str] | None = None
    sourceRole: str | None = None
    # By region id; regions without one receive by default.
    flow: dict[str, ReceiveMode] = Field(default_factory=dict)
    # The source's files when it is not part of this run, resolved by the editor.
    files: list[str] | None = None


class ValueRef(RequestModel):
    node: str
    output: str


class ValueRow(RequestModel):
    name: str
    value: str = ''
    groups: dict[str, str] | None = None
    # A pset node's row carries its parameter's IRAF type.
    type: str | None = None


class ValueNode(RequestModel):
    id: str
    run: Literal['value-constant', 'value-header', 'value-compute', 'pset']
    rows: list[ValueRow] = Field(default_factory=list)
    partition: str | None = None
    files: list[str] = Field(default_factory=list)
    fileLinks: list[dict[str, ParameterValue | list[str] | dict[str, str] | None]] = Field(default_factory=list)
    inputs: dict[str, ValueRef] = Field(default_factory=dict)


class ValueLink(RequestModel):
    id: str
    target: str
    parameter: str
    type: str = 's'
    source: ValueRef
    flow: dict[str, ReceiveMode] = Field(default_factory=dict)
    # Round values a value with labels is chosen by (a region member run alone).
    round: dict[str, str] | None = None


class WorkflowValues(RequestModel):
    """Value nodes and links into task parameters (giraf/values.py)."""
    nodes: list[ValueNode] = Field(default_factory=list)
    links: list[ValueLink] = Field(default_factory=list)
    # A task's latest run; inside loop regions, the run of each round.
    runs: dict[str, str | list[str]] = Field(default_factory=dict)


class FlowCriterion(RequestModel):
    """One of {keyword}, {expression, name}, {count, order}, {each}, {times}."""
    keyword: str | None = None
    expression: str | None = None
    name: str | None = None
    count: int | None = None
    order: str | None = None
    each: bool | None = None
    times: int | None = None


class FlowSplit(RequestModel):
    taskId: str
    outputRole: str | None = None


class WorkflowFlow(RequestModel):
    """A loop region (giraf/flows.py). Members are its tasks and inner regions."""
    id: str
    label: str = ''
    members: list[str] = Field(default_factory=list)
    criteria: list[FlowCriterion] = Field(default_factory=list)
    split: FlowSplit | None = None
    # The split source's files when it is not part of this run, resolved by the editor.
    splitFiles: list[str] = Field(default_factory=list)
    condition: str = ''


class WorkflowRequest(RequestModel):
    nodes: list[WorkflowNode]
    links: list[WorkflowLink] = Field(default_factory=list)
    values: WorkflowValues | None = None
    flows: list[WorkflowFlow] = Field(default_factory=list)

