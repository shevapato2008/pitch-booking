from typing import Literal, Self

from pydantic import AnyHttpUrl, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", case_sensitive=False, extra="ignore")

    app_env: Literal["development", "test", "staging", "production"] = "development"
    database_url: str = "sqlite+pysqlite:///:memory:"
    public_api_base_url: AnyHttpUrl | None = None
    public_image_hosts: tuple[str, ...] = ()

    @model_validator(mode="after")
    def require_deploy_configuration(self) -> Self:
        if self.app_env in {"staging", "production"}:
            if self.database_url == "sqlite+pysqlite:///:memory:":
                raise ValueError("DATABASE_URL is required for staging and production")
            if self.public_api_base_url is None:
                raise ValueError("PUBLIC_API_BASE_URL is required for staging and production")
            if not self.public_image_hosts:
                raise ValueError("PUBLIC_IMAGE_HOSTS is required for staging and production")
        return self
