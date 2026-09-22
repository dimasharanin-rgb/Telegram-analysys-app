"use client";

/**
 * Which language the report comes back in.
 *
 * Separate from the conversation's own language, and the copy says so: the
 * messages are analysed as written, and only the writing about them is
 * translated. Someone analysing a Russian conversation may well want the
 * report in Latvian, and neither choice should imply the other.
 *
 * The preference is remembered, because it is very unlikely to change
 * between analyses and asking again every time is a question with a known
 * answer.
 */

import * as React from "react";

import { analysisLanguages, resolveLanguage } from "@/lib/analysis/language";
import { SectionTitle } from "@/components/ui/Card";

const STORAGE_KEY = "ca_analysis_language";

/**
 * The remembered choice, or the browser's own preference.
 *
 * Both reads are guarded: storage throws in a private window, and a stored
 * value for a language this deployment no longer offers must not strand
 * someone on a language that is not in the list.
 */
export function initialLanguage(): string {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) return resolveLanguage(stored).code;
  } catch {
    // No storage available; fall through to the browser's preference.
  }
  try {
    return resolveLanguage(navigator.language).code;
  } catch {
    return resolveLanguage(null).code;
  }
}

export function rememberLanguage(code: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // A preference we cannot store is not worth failing an analysis over.
  }
}

export interface LanguagePickerProps {
  value: string;
  onChange: (code: string) => void;
}

export function LanguagePicker({ value, onChange }: LanguagePickerProps) {
  const languages = analysisLanguages();

  return (
    <div>
      <SectionTitle hint="Your messages are not translated">
        Report language
      </SectionTitle>
      <label className="sr-only" htmlFor="analysis-language">
        Analysis language
      </label>
      <select
        id="analysis-language"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          rememberLanguage(event.target.value);
        }}
        className="w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink"
      >
        {languages.map((language) => (
          <option key={language.code} value={language.code}>
            {language.nativeName}
            {language.nativeName === language.name ? "" : ` — ${language.name}`}
          </option>
        ))}
      </select>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        The insights, timeline, profile and PDF are written in this language. The
        conversation is read in whatever language it was written in, and quoted
        wording stays as it was sent.
      </p>
    </div>
  );
}
