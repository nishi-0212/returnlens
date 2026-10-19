"""Request/response models for the HTTP API."""
from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

RecStatus = Literal["proposed", "approved", "rejected", "completed"]


class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: str = Field(max_length=254)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if not EMAIL_RE.match(v):
            raise ValueError("Enter a valid email address")
        return v

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name is required")
        return v


class LoginIn(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        return v.strip().lower()


class UserOut(BaseModel):
    id: str
    name: str
    email: str


class AuthOut(BaseModel):
    token: str
    user: UserOut


class RecommendationUpdate(BaseModel):
    """Approve, reject or complete a recommendation, or change its owner/deadline."""
    status: RecStatus | None = None
    owner: str | None = Field(default=None, max_length=80)
    due_date: str | None = Field(default=None, max_length=10)
    implemented_at: str | None = Field(default=None, max_length=10)
    note: str | None = Field(default=None, max_length=500)

    @field_validator("due_date", "implemented_at")
    @classmethod
    def _date(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
            raise ValueError("Use YYYY-MM-DD")
        return v


class WriteOffShares(BaseModel):
    damaged: float | None = Field(default=None, ge=0, le=1)
    defective: float | None = Field(default=None, ge=0, le=1)
    incomplete: float | None = Field(default=None, ge=0, le=1)
    opened: float | None = Field(default=None, ge=0, le=1)
    unopened: float | None = Field(default=None, ge=0, le=1)
    unknown: float | None = Field(default=None, ge=0, le=1)


class AssumptionsIn(BaseModel):
    currency: str | None = Field(default=None, min_length=3, max_length=3, pattern="^[A-Z]{3}$")
    reverse_shipping_per_unit: float | None = Field(default=None, ge=0, le=10000)
    handling_per_return: float | None = Field(default=None, ge=0, le=10000)
    replacement_shipping_per_unit: float | None = Field(default=None, ge=0, le=10000)
    cost_share_of_price_if_unknown: float | None = Field(default=None, ge=0, le=1)
    write_off_share: WriteOffShares | None = None


class AlertUpdate(BaseModel):
    read: bool | None = None
    dismissed: bool | None = None
