"""Portable document structure; IRAF parameter semantics stay in task validation.

Sparse legacy documents keep their omitted fields. Unknown extension fields are
preserved, but known fields are validated strictly at every storage boundary.
"""
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class DocumentModel(BaseModel):
    model_config = ConfigDict(strict=True, extra='allow', allow_inf_nan=False)


class Draft(DocumentModel):
    parameters: dict[str, Any] = Field(default_factory=dict)
    inputs: dict[str, list[str]] = Field(default_factory=dict)
    output: dict[str, Any] = Field(default_factory=dict)
    exam: dict[str, Any] = Field(default_factory=dict)
    outputs: dict[str, str] = Field(default_factory=dict)
    textInputs: dict[str, str] = Field(default_factory=dict)
    cursorCommands: dict[str, str] = Field(default_factory=dict)


class Position(DocumentModel):
    x: float
    y: float


class FilePolicy(DocumentModel):
    mode: Literal['copy', 'direct'] = 'copy'
    backup: bool = True


class OutputPort(DocumentModel):
    id: str
    name: str
    files: list[str]
    outputRole: str | None = None


class Task(DocumentModel):
    id: str
    task: str = ''
    label: str = ''
    draft: Draft = Field(default_factory=Draft)
    preprocess: Draft = Field(default_factory=Draft)
    mapping: dict[str, Any] = Field(default_factory=dict)
    instrument: list[str] = Field(default_factory=list)
    packageValues: dict[str, Any] = Field(default_factory=dict)
    expressions: dict[str, str] = Field(default_factory=dict)
    parameterSets: dict[str, dict[str, Any]] = Field(default_factory=dict)
    filePolicy: FilePolicy = Field(default_factory=FilePolicy)
    backend: str = 'cl'
    position: Position | None = None
    collapsed: bool = False
    subflowId: str | None = None
    outputPorts: list[OutputPort] = Field(default_factory=list)


class CalibrationGroup(DocumentModel):
    filter: str | None = None
    exposure: float | None = None


class Source(DocumentModel):
    files: list[str] | None = None
    group: CalibrationGroup | None = None
    port: str | None = None
    outputRole: str | None = None


class FileSource(Source):
    kind: Literal['files']
    ids: list[str]
    label: str = ''


class ResultSource(Source):
    kind: Literal['result']
    ids: list[str]
    runId: str
    taskId: str | None = None
    label: str | None = None


class PendingSource(Source):
    kind: Literal['pending']
    taskId: str


class Connection(DocumentModel):
    id: str
    target: str
    role: str
    source: Annotated[FileSource | ResultSource | PendingSource, Field(discriminator='kind')]
    targetGroup: CalibrationGroup | None = None


class View(DocumentModel):
    selected: str = ''
    mode: Literal['map', 'list'] = 'map'
    zoom: float = 1
    x: float = 0
    y: float = 0
    focus: bool = False
    coordinateSystem: Literal['react-flow'] | None = None


class Subflow(DocumentModel):
    id: str
    name: str
    position: Position
    width: float
    height: float
    color: Literal['teal', 'blue', 'violet', 'amber', 'rose', 'slate'] | None = None


class MapRun(DocumentModel):
    id: str
    instanceId: str
    state: str
    products: list[dict[str, Any]]


class TaskMap(DocumentModel):
    version: Literal[1] = 1
    tasks: list[Task]
    connections: list[Connection]
    runs: list[MapRun] = Field(default_factory=list)
    view: View = Field(default_factory=View)
    subflows: list[Subflow] = Field(default_factory=list)


class DocumentMetadata(DocumentModel):
    path: str = ''
    name: str = Field(default='불러온 워크플로우', min_length=1, max_length=120)
    saved: bool = False


class Preferences(DocumentModel):
    taskMap: TaskMap
    document: DocumentMetadata = Field(default_factory=DocumentMetadata, alias='_document')
    drafts: dict[str, Draft] = Field(default_factory=dict)
    backend: str = 'cl'
    mapping: dict[str, Any] = Field(default_factory=dict)
    instrument: list[str] = Field(default_factory=list)
    packageValues: dict[str, Any] = Field(default_factory=dict)


class ImportedDraft(Draft):
    parameters: dict[str, Any]
    inputs: dict[str, list[str]]
    output: dict[str, Any]
    exam: dict[str, Any]


class ImportedTask(Task):
    # Imports must be self-contained; existing on-disk drafts may be sparse.
    task: str
    label: str
    draft: ImportedDraft
    preprocess: Draft
    mapping: dict[str, Any]
    packageValues: dict[str, Any]
    expressions: dict[str, str]
    filePolicy: FilePolicy


class ImportedMap(TaskMap):
    version: Literal[1]
    tasks: list[ImportedTask]


class ImportedPreferences(Preferences):
    taskMap: ImportedMap


class PortableDocument(DocumentModel):
    format: Literal['giraf-workflow']
    version: Literal[1]
    name: str = Field(min_length=1, max_length=120)
    taskMap: TaskMap
    preferences: dict[str, Any] = Field(default_factory=dict)
