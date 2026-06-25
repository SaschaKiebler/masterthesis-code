from pydantic import BaseModel


class TimeRange(BaseModel):
    start: int  # Unix epoch seconds
    end: int


class DescriptiveRequest(BaseModel):
    metric_point_ids: list[str]
    time_range: TimeRange


class TimeseriesRequest(BaseModel):
    metric_point_ids: list[str]
    time_range: TimeRange
    resample: str = "auto"  # "5min", "15min", "1h", "6h", "1d", "auto"
    aggregation: str = "mean"  # "mean", "min", "max", "sum"
    rolling_window: str | None = None  # "1h", "24h", "7d"


class DifferenceRequest(BaseModel):
    metric_point_id_a: str
    metric_point_id_b: str
    time_range: TimeRange
    resample: str = "auto"
