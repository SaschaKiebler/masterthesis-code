from pydantic import BaseModel


class ResponseMeta(BaseModel):
    computation_time_ms: int
    data_points_processed: int


class MetricStats(BaseModel):
    metric_point_id: str
    device_id: str
    metric_id: int
    display_name: str | None
    unit: str | None
    count: int
    mean: float
    median: float
    std: float
    min: float
    max: float
    q25: float
    q75: float
    iqr: float


class DescriptiveResponse(BaseModel):
    metrics: list[MetricStats]
    meta: ResponseMeta


class TimeseriesPoint(BaseModel):
    time: int  # Unix epoch seconds
    value: float | None


class TimeseriesSeries(BaseModel):
    metric_point_id: str
    display_name: str | None
    unit: str | None
    values: list[TimeseriesPoint]
    rolling_values: list[TimeseriesPoint] | None = None


class TimeseriesResponse(BaseModel):
    series: list[TimeseriesSeries]
    bucket_seconds: int
    meta: ResponseMeta


class DifferenceSeries(BaseModel):
    label: str
    values: list[TimeseriesPoint]


class DifferenceResponse(BaseModel):
    difference: DifferenceSeries
    meta: ResponseMeta
