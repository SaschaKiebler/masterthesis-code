from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://postgres:password@localhost:5432/digital_demon"
    db_min_pool: int = 2
    db_max_pool: int = 10
    log_level: str = "info"
    port: int = 8100
    workers: int = 1

    model_config = {"env_prefix": "", "case_sensitive": False}


settings = Settings()
