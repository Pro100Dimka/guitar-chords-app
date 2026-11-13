import pytest

from freetune_analysis.config import Settings
from freetune_analysis.pipeline import AnalysisError, decode_audio


def test_playlist_cannot_make_decoder_fetch_network_resources(tmp_path):
    source = tmp_path / "uploaded.mp3"
    source.write_text("#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\n"
                      "http://127.0.0.1:9/private-audio.ts\n#EXT-X-ENDLIST\n")
    with pytest.raises(AnalysisError, match="invalid_audio"):
        decode_audio(source, tmp_path / "decoded.wav", Settings(data_dir=tmp_path))
    assert not (tmp_path / "decoded.wav").exists()
