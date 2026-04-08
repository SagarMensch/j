from __future__ import annotations

import logging
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import torch

from app.core.config import Settings

try:
    import segmentation_models_pytorch as smp
except ImportError:  # pragma: no cover - exercised when deps are absent
    smp = None


@dataclass(frozen=True, slots=True)
class ModelCandidate:
    architecture: str
    encoder_name: str
    in_channels: int
    wrapped: bool


class ChannelAttentionGate(torch.nn.Module):
    def __init__(self, in_ch: int, reduction: int = 4) -> None:
        super().__init__()
        hidden = max(1, in_ch // reduction)
        self.gate = torch.nn.Sequential(
            torch.nn.AdaptiveAvgPool2d(1),
            torch.nn.Flatten(),
            torch.nn.Linear(in_ch, hidden),
            torch.nn.ReLU(inplace=True),
            torch.nn.Linear(hidden, in_ch),
            torch.nn.Sigmoid(),
        )

    def forward(self, tensor: torch.Tensor) -> torch.Tensor:
        weights = self.gate(tensor).unsqueeze(-1).unsqueeze(-1)
        return tensor * weights


class ForgeryDetector(torch.nn.Module):
    def __init__(self, seg_model: torch.nn.Module, n_ch: int) -> None:
        super().__init__()
        self.channel_gate = ChannelAttentionGate(n_ch, reduction=4)
        self.seg_model = seg_model

    def forward(self, tensor: torch.Tensor) -> torch.Tensor:
        return self.seg_model(self.channel_gate(tensor))


class ModelLoader:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.logger = logging.getLogger(self.__class__.__name__)
        self.device = self._resolve_device(settings.model_device)
        self.model: Any | None = None
        self.selected_architecture: str | None = None
        self.selected_encoder: str | None = None
        self.input_channels: int | None = None
        self.model_wrapped: bool | None = None
        self.model_parameter_count: int | None = None
        self.model_loaded: bool = False
        self.load_error: str | None = None
        self.checkpoint_input_channels: int | None = None
        self.tried_architectures: list[str] = []

    def _resolve_device(self, preferred: str) -> str:
        if preferred == "cpu":
            return "cpu"
        if preferred == "cuda":
            return "cuda" if torch.cuda.is_available() else "cpu"
        return "cuda" if torch.cuda.is_available() else "cpu"

    def _normalise_state_dict(self, raw: object) -> OrderedDict[str, torch.Tensor]:
        if isinstance(raw, OrderedDict):
            state_dict = raw
        elif isinstance(raw, dict):
            for key in ("state_dict", "model_state_dict", "model", "weights"):
                value = raw.get(key)
                if isinstance(value, (dict, OrderedDict)):
                    state_dict = OrderedDict(value)
                    break
            else:
                raise RuntimeError("Checkpoint dictionary does not contain a state dict.")
        else:
            raise RuntimeError(f"Unsupported checkpoint object type: {type(raw)!r}")

        cleaned = OrderedDict()
        for key, value in state_dict.items():
            new_key = key[7:] if key.startswith("module.") else key
            cleaned[new_key] = value
        return cleaned

    def _inspect_state_dict(self, state_dict: OrderedDict[str, torch.Tensor]) -> int | None:
        candidate_keys = [
            "seg_model.encoder._conv_stem.weight",
            "encoder._conv_stem.weight",
            "seg_model.encoder.patch_embed1.proj.weight",
            "encoder.patch_embed1.proj.weight",
        ]
        for key in candidate_keys:
            value = state_dict.get(key)
            if value is not None and value.ndim == 4:
                return int(value.shape[1])
        return None

    @staticmethod
    def _checkpoint_uses_wrapper(state_dict: OrderedDict[str, torch.Tensor]) -> bool:
        return any(key.startswith("channel_gate.") or key.startswith("seg_model.") for key in state_dict)

    def _candidate_architectures(
        self,
        inferred_channels: int | None,
        checkpoint_config: dict[str, object],
        wrapped_hint: bool,
    ) -> list[ModelCandidate]:
        encoder_candidates: list[str] = []
        for encoder_name in [
            checkpoint_config.get("ENCODER"),
            "mit_b5",
            "mit_b4",
            "efficientnet-b5",
            "efficientnet-b4",
            "efficientnet-b3",
            "efficientnet-b2",
        ]:
            if isinstance(encoder_name, str) and encoder_name and encoder_name not in encoder_candidates:
                encoder_candidates.append(encoder_name)

        channel_candidates: list[int] = []
        for value in [checkpoint_config.get("N_CH"), inferred_channels, 13, 12]:
            if isinstance(value, int) and value > 0 and value not in channel_candidates:
                channel_candidates.append(value)

        wrapper_candidates = [wrapped_hint]
        if wrapped_hint is not False:
            wrapper_candidates.append(False)
        if wrapped_hint is not True:
            wrapper_candidates.append(True)

        merged: list[ModelCandidate] = []
        seen: set[tuple[str, str, int, bool]] = set()
        for architecture in ("unetplusplus", "unet"):
            for wrapped in wrapper_candidates:
                for encoder_name in encoder_candidates:
                    for in_channels in channel_candidates:
                        key = (architecture, encoder_name, in_channels, wrapped)
                        if key in seen:
                            continue
                        seen.add(key)
                        merged.append(
                            ModelCandidate(
                                architecture=architecture,
                                encoder_name=encoder_name,
                                in_channels=in_channels,
                                wrapped=wrapped,
                            )
                        )
        return merged

    def _build_model(self, candidate: ModelCandidate) -> Any:
        if smp is None:
            raise RuntimeError(
                "segmentation-models-pytorch is not installed. "
                "Install requirements before loading the checkpoint."
            )
        common_kwargs = {
            "encoder_name": candidate.encoder_name,
            "encoder_weights": None,
            "in_channels": candidate.in_channels,
            "classes": 1,
            "activation": None,
        }
        if candidate.architecture == "unetplusplus":
            base_model = smp.UnetPlusPlus(
                decoder_channels=(256, 128, 64, 32, 16),
                **common_kwargs,
            )
        else:
            base_model = smp.Unet(**common_kwargs)
        if candidate.wrapped:
            return ForgeryDetector(base_model, n_ch=candidate.in_channels)
        return base_model

    def load(self) -> None:
        checkpoint_path = Path(self.settings.checkpoint_path)
        self.tried_architectures = []
        self.model_loaded = False
        self.load_error = None
        self.model = None
        self.selected_architecture = None
        self.selected_encoder = None
        self.input_channels = None
        self.model_wrapped = None
        self.model_parameter_count = None

        if not checkpoint_path.exists():
            self.load_error = f"Checkpoint not found at {checkpoint_path}"
            self.logger.error(self.load_error)
            return

        try:
            raw_checkpoint = torch.load(checkpoint_path, map_location="cpu")
            state_dict = self._normalise_state_dict(raw_checkpoint)
        except Exception as exc:  # pragma: no cover - defensive path
            self.load_error = f"Failed to read checkpoint: {exc}"
            self.logger.exception(self.load_error)
            return

        checkpoint_config = raw_checkpoint.get("config", {}) if isinstance(raw_checkpoint, dict) else {}

        self.checkpoint_input_channels = self._inspect_state_dict(state_dict)
        wrapped_hint = self._checkpoint_uses_wrapper(state_dict)
        self.logger.info(
            "Checkpoint inspection complete",
            extra={
                "checkpoint_path": str(checkpoint_path),
                "checkpoint_input_channels": self.checkpoint_input_channels,
                "checkpoint_wrapped": wrapped_hint,
            },
        )

        errors: list[str] = []
        for candidate in self._candidate_architectures(
            self.checkpoint_input_channels,
            checkpoint_config if isinstance(checkpoint_config, dict) else {},
            wrapped_hint,
        ):
            candidate_name = (
                f"{candidate.architecture}:{candidate.encoder_name}:"
                f"{candidate.in_channels}:{'wrapped' if candidate.wrapped else 'plain'}"
            )
            self.tried_architectures.append(candidate_name)
            try:
                model = self._build_model(candidate)
                model.load_state_dict(state_dict, strict=True)
                model = model.to(self.device)
                model.eval()

                self.model = model
                self.selected_architecture = candidate.architecture
                self.selected_encoder = candidate.encoder_name
                self.input_channels = candidate.in_channels
                self.model_wrapped = candidate.wrapped
                self.model_parameter_count = sum(
                    parameter.numel() for parameter in model.parameters()
                )
                self.model_loaded = True
                self.logger.info(
                    "Segmentation checkpoint loaded",
                    extra={
                        "checkpoint_path": str(checkpoint_path),
                        "selected_architecture": candidate.architecture,
                        "selected_encoder": candidate.encoder_name,
                        "input_channels": candidate.in_channels,
                        "wrapped": candidate.wrapped,
                        "device": self.device,
                    },
                )
                return
            except Exception as exc:
                errors.append(f"{candidate_name} -> {exc}")

        self.load_error = (
            "Failed to load checkpoint with supported architectures. "
            f"Tried: {', '.join(self.tried_architectures)}. "
            f"Errors: {' | '.join(errors)}"
        )
        self.logger.error(self.load_error)

    def predict(self, tensor: torch.Tensor) -> torch.Tensor:
        if not self.model_loaded or self.model is None:
            raise RuntimeError(self.load_error or "Segmentation model is not loaded.")
        with torch.no_grad():
            prediction = self.model(tensor.to(self.device))
        if isinstance(prediction, (tuple, list)):
            return prediction[0]
        return prediction

    def info(self) -> dict[str, Any]:
        return {
            "checkpoint_path": str(self.settings.checkpoint_path),
            "selected_architecture": self.selected_architecture,
            "selected_encoder": self.selected_encoder,
            "input_channels": self.input_channels,
            "wrapped": self.model_wrapped,
            "device": self.device,
            "model_parameter_count": self.model_parameter_count,
            "model_loaded": self.model_loaded,
            "load_error": self.load_error,
            "checkpoint_input_channels": self.checkpoint_input_channels,
            "tried_architectures": self.tried_architectures,
        }
