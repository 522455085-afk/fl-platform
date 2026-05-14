"use client";

/**
 * Mounted once at the root of the app. Subscribes to theme-store and
 * pushes the active palette into `<html>` inline styles whenever it
 * changes. Renders nothing.
 */

import { useEffect } from "react";
import { useTheme, getActiveTheme, applyTheme } from "@/lib/theme-store";

export default function ThemeApplier() {
  const themeId = useTheme((s) => s.themeId);
  useEffect(() => {
    applyTheme(getActiveTheme(themeId));
  }, [themeId]);
  return null;
}
