import * as React from "react"
import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar"

import { cn } from "./lib/utils"

/**
 * Avatar v2.2 redesign:
 *  - NEW `color` prop on AvatarFallback: "brand" | "green" | "blue" | "amber" | "default"
 *    Maps initials to a semantic palette instead of uniform muted grey.
 *    Use `getAvatarColor(name)` helper to deterministically hash a name string
 *    to a colour — same name always gets the same colour across renders.
 *  - Border ring now uses `mix-blend-multiply` (light) / `mix-blend-screen` (dark)
 *    for a more natural overlay on coloured fallbacks.
 *  - AvatarBadge, AvatarGroup, AvatarGroupCount unchanged.
 */

// ── Colour helper ─────────────────────────────────────────────────────────────

type AvatarColor = "brand" | "green" | "blue" | "amber" | "default"

const avatarColorMap: Record<AvatarColor, string> = {
  brand:   "bg-brand-muted text-brand-text",
  green:   "bg-bull-bg text-bull",
  blue:    "bg-info-bg text-info",
  amber:   "bg-warning-bg text-warning-fg",
  default: "bg-muted text-muted-foreground",
}

const COLOR_CYCLE: AvatarColor[] = ["brand", "green", "blue", "amber"]

/**
 * Deterministically maps a string (name / user-id) to an AvatarColor.
 * Same input → same colour, across renders and sessions.
 */
function getAvatarColor(seed: string): AvatarColor {
  if (!seed) return "default"
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  return COLOR_CYCLE[hash % COLOR_CYCLE.length]
}

// ── Components ────────────────────────────────────────────────────────────────

function Avatar({
  className,
  size = "default",
  ...props
}: AvatarPrimitive.Root.Props & {
  size?: "default" | "sm" | "lg"
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        "group/avatar relative flex size-8 shrink-0 rounded-full select-none",
        // Overlay ring that works on both solid images and coloured fallbacks
        "after:absolute after:inset-0 after:rounded-full after:border after:border-foreground/10 after:mix-blend-multiply dark:after:mix-blend-screen",
        "data-[size=lg]:size-10 data-[size=sm]:size-6",
        className
      )}
      {...props}
    />
  )
}

function AvatarImage({ className, ...props }: AvatarPrimitive.Image.Props) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn("aspect-square size-full rounded-full object-cover", className)}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  color = "default",
  ...props
}: AvatarPrimitive.Fallback.Props & { color?: AvatarColor }) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center rounded-full text-sm font-semibold",
        "group-data-[size=sm]/avatar:text-[0.625rem]",
        avatarColorMap[color],
        className
      )}
      {...props}
    />
  )
}

function AvatarBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        "absolute right-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full",
        "bg-primary text-primary-foreground ring-2 ring-background select-none",
        "group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:[&>svg]:hidden",
        "group-data-[size=default]/avatar:size-2.5 group-data-[size=default]/avatar:[&>svg]:size-2",
        "group-data-[size=lg]/avatar:size-3 group-data-[size=lg]/avatar:[&>svg]:size-2",
        className
      )}
      {...props}
    />
  )
}

function AvatarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        "group/avatar-group flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background",
        className
      )}
      {...props}
    />
  )
}

function AvatarGroupCount({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group-count"
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center rounded-full",
        "bg-muted text-sm tabular-nums text-muted-foreground ring-2 ring-background",
        "group-has-data-[size=lg]/avatar-group:size-10",
        "group-has-data-[size=sm]/avatar-group:size-6",
        "[&>svg]:size-4",
        "group-has-data-[size=lg]/avatar-group:[&>svg]:size-5",
        "group-has-data-[size=sm]/avatar-group:[&>svg]:size-3",
        className
      )}
      {...props}
    />
  )
}

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarBadge,
  getAvatarColor,
  type AvatarColor,
}
