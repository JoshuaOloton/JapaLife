"use client";

import { Component, type ReactNode } from "react";

/**
 * Shows `fallback` instead of crashing the scene if a model fails to download
 * (a flaky mobile connection), so the player can still walk around.
 */
export class ModelBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
