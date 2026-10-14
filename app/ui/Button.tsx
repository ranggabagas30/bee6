"use client";

import type { ComponentPropsWithRef, MouseEvent } from "react";
import { cx } from "@/app/ui/cx";

export type ButtonVariant = "primary" | "secondary" | "destructive";
export type ButtonSize = "md" | "lg";

interface LookProps {
  variant?: ButtonVariant;
  /** `md` is the 44px control; `lg` is the 56px hero pill. */
  size?: ButtonSize;
  /** Full width of the container. */
  block?: boolean;
}

/** Class list for the button look, for elements that are not <Button>, such as next/link. */
export function buttonClassName({
  variant = "primary",
  size = "md",
  block = false,
  className,
}: LookProps & { className?: string }): string {
  return cx("b6-btn", `b6-btn--${variant}`, size === "lg" && "b6-btn--lg", block && "b6-btn--block", className);
}

export interface ButtonProps extends LookProps, ComponentPropsWithRef<"button"> {}

/**
 * Native <button>. `disabled` is the real attribute (not focusable, not clickable). Icon-only buttons must pass
 * `aria-label`; the icon itself should be `aria-hidden`.
 */
export function Button({ variant, size, block, className, type = "button", ...rest }: ButtonProps) {
  return <button {...rest} type={type} className={buttonClassName({ variant, size, block, className })} />;
}

export interface ButtonLinkProps extends LookProps, ComponentPropsWithRef<"a"> {
  disabled?: boolean;
}

/**
 * Anchor with the button look. An anchor cannot be `disabled`, so a disabled link loses its href, keeps
 * role="link" and says `aria-disabled="true"`; clicks are swallowed.
 */
export function ButtonLink({ variant, size, block, className, disabled = false, href, onClick, ...rest }: ButtonLinkProps) {
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (disabled) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
  };
  return (
    <a
      {...rest}
      {...(disabled ? { role: "link", "aria-disabled": true } : { href })}
      onClick={handleClick}
      className={buttonClassName({ variant, size, block, className })}
    />
  );
}
