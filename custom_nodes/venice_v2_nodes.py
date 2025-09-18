"""Placeholder Venice V2 specific nodes.

These nodes are light-weight placeholders that forward their inputs so they can
be wired inside workflows while backend integrations are developed. They expose
basic metadata fields that Venice uses to track requests.
"""
from __future__ import annotations

from typing import Any, Dict, Tuple


class VeniceV2Input:
    """Collect metadata and propagate prompt information.

    The node is intentionally simple; it forwards every value that enters it so
    that downstream nodes can access the uploaded image, textual prompt and
    Venice specific identifiers.
    """

    CATEGORY = "VeniceV2"
    RETURN_TYPES: Tuple[str, str, str, str, str] = (
        "IMAGE",
        "STRING",
        "STRING",
        "STRING",
        "STRING",
    )
    RETURN_NAMES: Tuple[str, str, str, str, str] = (
        "image",
        "prompt",
        "user_id",
        "workflow_id",
        "api_key",
    )
    FUNCTION = "forward"

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Dict[str, Tuple[Any, Dict[str, Any]]]]:
        return {
            "required": {
                "image": ("IMAGE",),
                "prompt": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                        "tooltip": "Text prompt that accompanies the request.",
                    },
                ),
                "user_id": (
                    "STRING",
                    {
                        "default": "",
                        "tooltip": "External user identifier.",
                    },
                ),
                "workflow_id": (
                    "STRING",
                    {
                        "default": "",
                        "tooltip": "Identifier of the Venice workflow instance.",
                    },
                ),
                "api_key": (
                    "STRING",
                    {
                        "default": "",
                        "tooltip": "API key forwarded to downstream Venice tooling.",
                    },
                ),
            }
        }

    @staticmethod
    def forward(
        image,
        prompt: str,
        user_id: str,
        workflow_id: str,
        api_key: str,
    ) -> Tuple[Any, str, str, str, str]:
        return image, prompt, user_id, workflow_id, api_key


class VeniceV2Output:
    """Gather generated artefacts for Venice pipelines.

    The node exposes the same metadata inputs as the input node so workflows can
    terminate with a consistent signature while Venice specific integrations are
    stubbed out.
    """

    CATEGORY = "VeniceV2"
    OUTPUT_NODE = True
    RETURN_TYPES: Tuple[str] = ("STRING",)
    RETURN_NAMES: Tuple[str] = ("status",)
    FUNCTION = "finalize"

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Dict[str, Tuple[Any, Dict[str, Any]]]]:
        return {
            "required": {
                "image": ("IMAGE",),
                "prompt": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                    },
                ),
                "user_id": (
                    "STRING",
                    {
                        "default": "",
                    },
                ),
                "workflow_id": (
                    "STRING",
                    {
                        "default": "",
                    },
                ),
                "api_key": (
                    "STRING",
                    {
                        "default": "",
                    },
                ),
            },
            "optional": {
                "notes": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                        "tooltip": "Optional notes or debugging context.",
                    },
                )
            },
        }

    @staticmethod
    def finalize(
        image,
        prompt: str,
        user_id: str,
        workflow_id: str,
        api_key: str,
        notes: str = "",
    ) -> Tuple[str]:
        summary = (
            "VeniceV2 output placeholder -- values received: "
            f"user_id={user_id!r}, workflow_id={workflow_id!r}, api_key_present={bool(api_key)}, "
            f"prompt_length={len(prompt)}, notes_length={len(notes)}"
        )
        return (summary,)


class FALAiTextToImage:
    """Placeholder node for FAL.ai integrations.

    The node simply echoes the configuration. It accepts a text prompt and a
    model choice so workflows can already be authored while the actual API
    connectivity is implemented separately.
    """

    CATEGORY = "VeniceV2"
    RETURN_TYPES: Tuple[str] = ("STRING",)
    RETURN_NAMES: Tuple[str] = ("result",)
    FUNCTION = "generate"

    MODELS: Tuple[str, ...] = (
        "fal-ai/flux-pro",
        "fal-ai/flux-pro-v",
        "fal-ai/flux-pro-ultra",
        "fal-ai/fast-lightning",
    )

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Dict[str, Tuple[Any, Dict[str, Any]]]]:
        return {
            "required": {
                "prompt": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                        "tooltip": "Prompt forwarded to the FAL.ai endpoint.",
                    },
                ),
                "model": (list(cls.MODELS), {
                    "default": cls.MODELS[0],
                }),
                "api_key": (
                    "STRING",
                    {
                        "default": "",
                        "tooltip": "Optional FAL.ai API key placeholder.",
                    },
                ),
            }
        }

    @staticmethod
    def generate(prompt: str, model: str, api_key: str) -> Tuple[str]:
        message = (
            "FAL.ai placeholder execution -- "
            f"model={model}, prompt_length={len(prompt)}, api_key_present={bool(api_key)}"
        )
        return (message,)


NODE_CLASS_MAPPINGS = {
    "VeniceV2-Input": VeniceV2Input,
    "VeniceV2-Output": VeniceV2Output,
    "FAL.ai-TextToImage": FALAiTextToImage,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "VeniceV2-Input": "VeniceV2 Input",
    "VeniceV2-Output": "VeniceV2 Output",
    "FAL.ai-TextToImage": "FAL.ai Text-to-Image",
}
