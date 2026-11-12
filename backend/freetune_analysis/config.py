from dataclasses import dataclass
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
        )
