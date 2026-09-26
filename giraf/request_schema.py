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
    filePolicy: FilePolicy = Field(default_factory=FilePolicy)
    workingDirectory: str | None = None
    instanceId: str | None = None
    fileConfirmation: str | None = None


class WorkflowNode(RequestModel):
    id: str
    label: str
    payload: TaskRequest


class WorkflowLink(RequestModel):
    source: str
    target: str
    role: str
    kind: str
    multiple: bool
    sourceFiles: list[str] | None = None
    sourceGroup: dict[str, ParameterValue | None] | None = None
    sourceRole: str | None = None


class WorkflowRequest(RequestModel):
    nodes: list[WorkflowNode]
    links: list[WorkflowLink] = Field(default_factory=list)

