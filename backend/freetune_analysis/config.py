from dataclasses import dataclass
import ipaddress
import os
from pathlib import Path


MODEL_REVISIONS = {
    "small": ("Systran/faster-whisper-small", "536b0662742c02347bc0e980a01041f333bce120"),
    "turbo": ("dropbox-dash/faster-whisper-large-v3-turbo", "0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf"),
}


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    whisper_model: str = "small"
    whisper_path: Path | None = None
    device: str = "cpu"
    compute_type: str = "int8"
    cpu_threads: int = 4
    token: str = ""
    max_upload_bytes: int = 256 * 1024 * 1024
    max_duration_seconds: int = 1800
    max_rss_mb: int = 4096
    max_job_seconds: int = 3600
    retention_hours: int = 24
    max_queued_jobs: int = 8
    service_mode: str = "private"
    installation_ttl_days: int = 90
    active_jobs_per_installation: int = 2
    jobs_per_day: int = 20
    jobs_per_network_day: int = 60
    registrations_per_network_day: int = 5
    registrations_per_hour: int = 100
    requests_per_minute: int = 120
    cancellations_per_minute: int = 30
    max_http_requests: int = 32
    max_concurrent_uploads: int = 2
    upload_timeout_seconds: float = 300
    max_storage_bytes: int = 2 * 1024**3
    trusted_proxy_ips: tuple[str, ...] = ()

    def __post_init__(self):
        if self.service_mode not in {"private", "shared"}:
            raise ValueError("FREETUNE_SERVICE_MODE must be private or shared")
        if self.service_mode == "shared" and self.token:
            raise ValueError("Shared installations do not use FREETUNE_API_TOKEN")
        if self.service_mode == "shared" and (self.installation_ttl_days != 90 or self.retention_hours != 24):
            raise ValueError("The shared privacy profile requires 90-day installation access and 24-hour results")
        for address in self.trusted_proxy_ips:
            # Exact addresses only: never trust arbitrary forwarded headers or broad CIDRs.
            ipaddress.ip_address(address)

    @property
    def decoded_reservation_bytes(self) -> int:
        # The decoder writes mono 22,050 Hz signed 16-bit PCM, plus WAV metadata.
        return self.max_duration_seconds * 22050 * 2 + 1024 * 1024

    @property
    def model_path(self) -> Path:
        return self.whisper_path or self.data_dir / "models" / f"whisper-{self.whisper_model}"

    @property
    def jobs_dir(self) -> Path:
        return self.data_dir / "jobs"

    @classmethod
    def from_env(cls):
        model = os.getenv("FREETUNE_WHISPER_MODEL", "small")
        if model not in MODEL_REVISIONS:
            raise ValueError("FREETUNE_WHISPER_MODEL must be small or turbo")
        device = os.getenv("FREETUNE_DEVICE", "cpu")
        if device not in {"cpu", "cuda"}:
            raise ValueError("FREETUNE_DEVICE must be cpu or cuda")
        path = os.getenv("FREETUNE_WHISPER_PATH")
        return cls(
            data_dir=Path(os.getenv("FREETUNE_DATA_DIR", str(Path(__file__).resolve().parents[1] / "data"))).resolve(),
            whisper_model=model,
            whisper_path=Path(path).resolve() if path else None,
            device=device,
            compute_type=os.getenv("FREETUNE_COMPUTE_TYPE", "int8" if device == "cpu" else "float16"),
            cpu_threads=max(1, int(os.getenv("FREETUNE_CPU_THREADS", "4"))),
            token=os.getenv("FREETUNE_API_TOKEN", ""),
            max_upload_bytes=max(1024, int(os.getenv("FREETUNE_MAX_UPLOAD_MB", "256")) * 1024 * 1024),
            max_duration_seconds=max(1, int(os.getenv("FREETUNE_MAX_DURATION_SECONDS", "1800"))),
            max_rss_mb=max(128, int(os.getenv("FREETUNE_MAX_RSS_MB", "4096"))),
            max_job_seconds=max(1, int(os.getenv("FREETUNE_MAX_JOB_SECONDS", "3600"))),
            retention_hours=max(1, int(os.getenv("FREETUNE_RETENTION_HOURS", "24"))),
            max_queued_jobs=max(1, int(os.getenv("FREETUNE_MAX_QUEUED_JOBS", "8"))),
            service_mode=os.getenv("FREETUNE_SERVICE_MODE", "private"),
            installation_ttl_days=max(1, int(os.getenv("FREETUNE_INSTALLATION_TTL_DAYS", "90"))),
            active_jobs_per_installation=max(1, int(os.getenv("FREETUNE_ACTIVE_JOBS_PER_INSTALLATION", "2"))),
            jobs_per_day=max(1, int(os.getenv("FREETUNE_JOBS_PER_DAY", "20"))),
            jobs_per_network_day=max(1, int(os.getenv("FREETUNE_JOBS_PER_NETWORK_DAY", "60"))),
            registrations_per_network_day=max(1, int(os.getenv("FREETUNE_REGISTRATIONS_PER_NETWORK_DAY", "5"))),
            registrations_per_hour=max(1, int(os.getenv("FREETUNE_REGISTRATIONS_PER_HOUR", "100"))),
            requests_per_minute=max(1, int(os.getenv("FREETUNE_REQUESTS_PER_MINUTE", "120"))),
            cancellations_per_minute=max(1, int(os.getenv("FREETUNE_CANCELLATIONS_PER_MINUTE", "30"))),
            max_http_requests=max(1, int(os.getenv("FREETUNE_MAX_HTTP_REQUESTS", "32"))),
            max_concurrent_uploads=max(1, int(os.getenv("FREETUNE_MAX_CONCURRENT_UPLOADS", "2"))),
            upload_timeout_seconds=max(0.1, float(os.getenv("FREETUNE_UPLOAD_TIMEOUT_SECONDS", "300"))),
            max_storage_bytes=max(1, int(os.getenv("FREETUNE_MAX_STORAGE_MB", "2048"))) * 1024**2,
            trusted_proxy_ips=tuple(x.strip() for x in os.getenv("FREETUNE_TRUSTED_PROXY_IPS", "").split(",") if x.strip()),
        )
