"use client";

import * as React from "react";

import {
  ANALYSIS_MODULES,
  MODULE_DEFINITIONS,
  type AnalysisModule,
} from "@/lib/analysis/modules";
import {
  formatPrice,
  PRODUCTS,
  type AnalysisProduct,
} from "@/lib/billing/products";
import { cx, formatNumber } from "@/lib/client/format";
import { Badge } from "@/components/ui/Badge";
import { SectionTitle } from "@/components/ui/Card";

export interface PlanPickerProps {
  productId: string;
  onProductChange: (id: string) => void;
  modules: AnalysisModule[];
  onModulesChange: (modules: AnalysisModule[]) => void;
  messageCount: number;
}

/**
 * Choosing what to run.
 *
 * Prices and limits come from the product catalogue, so nothing here decides
 * what a tier means. Options this build cannot deliver are shown with the
 * reason rather than hidden, and they cannot be selected.
 */
export function PlanPicker({
  productId,
  onProductChange,
  modules,
  onModulesChange,
  messageCount,
}: PlanPickerProps) {
  const product = PRODUCTS.find((entry) => entry.id === productId);

  const toggle = (id: AnalysisModule) => {
    onModulesChange(
      modules.includes(id)
        ? modules.filter((entry) => entry !== id)
        : [...modules, id],
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <SectionTitle hint={`${formatNumber(messageCount)} messages to analyse`}>
          Choose an analysis
        </SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          {PRODUCTS.map((entry) => (
            <ProductCard
              key={entry.id}
              product={entry}
              selected={entry.id === productId}
              tooLarge={messageCount > entry.maxMessages}
              onSelect={() => onProductChange(entry.id)}
            />
          ))}
        </div>
      </div>

      {product ? (
        <div>
          <SectionTitle hint="Unselect anything you don't want">
            What to include
          </SectionTitle>
          <ul className="space-y-2">
            {ANALYSIS_MODULES.map((id) => {
              const definition = MODULE_DEFINITIONS[id];
              const allowed = product.allowedModules.includes(id);
              const checked = allowed && modules.includes(id);

              return (
                <li key={id}>
                  <label
                    className={cx(
                      "flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3",
                      allowed
                        ? "border-line bg-white hover:border-brand-200"
                        : "cursor-not-allowed border-line bg-canvas-soft",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0 accent-brand-600"
                      checked={checked}
                      disabled={!allowed}
                      onChange={() => toggle(id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span
                          className={cx(
                            "text-sm font-medium",
                            allowed ? "text-ink" : "text-muted",
                          )}
                        >
                          {definition.name}
                        </span>
                        {!definition.batch ? (
                          <Badge tone="neutral">On demand</Badge>
                        ) : null}
                        {!allowed ? <Badge tone="caution">Not in this option</Badge> : null}
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                        {definition.description}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-faint">
            The two on-demand tools do not run now. They become available on the
            finished analysis, where you pick the moment to ask about.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ProductCard({
  product,
  selected,
  tooLarge,
  onSelect,
}: {
  product: AnalysisProduct;
  selected: boolean;
  tooLarge: boolean;
  onSelect: () => void;
}) {
  const disabled = !product.available || tooLarge;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cx(
        "flex h-full flex-col rounded-xl border px-4 py-4 text-left transition-colors",
        selected
          ? "border-2 border-brand-600 bg-brand-50"
          : "border-line bg-white hover:border-brand-200",
        disabled && "cursor-not-allowed border-line bg-canvas-soft opacity-80",
      )}
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-ink">{product.name}</span>
        <span
          className={cx(
            "shrink-0 text-sm font-semibold tabular-nums",
            selected ? "text-brand-700" : "text-ink",
          )}
        >
          {formatPrice(product)}
        </span>
      </span>

      <span className="mt-1.5 block text-xs leading-relaxed text-muted">
        {product.description}
      </span>

      <span className="mt-3 block text-xs text-faint">
        Up to {formatNumber(product.maxMessages)} messages
        {product.credits > 1 ? ` · ${product.credits} analyses` : ""}
      </span>

      {!product.available && product.unavailableReason ? (
        <span className="mt-2 block text-xs leading-relaxed text-caution">
          {product.unavailableReason}
        </span>
      ) : null}

      {product.available && tooLarge ? (
        <span className="mt-2 block text-xs leading-relaxed text-caution">
          This conversation is larger than this option covers.
        </span>
      ) : null}
    </button>
  );
}
