"use client";

import React, { useMemo } from "react";
import { Globe } from "lucide-react";
import { buildCountryOptions, type CountryInfo } from "@/lib/countries";

interface CountryFilterProps {
  /** Raw country values (`"US"`, `"Sri Lanka"`, …) discovered in the playlist. */
  countries: string[];
  /** Currently selected country — `"All"` for no filtering. */
  selected: string;
  onSelect: (country: string) => void;
  /** Render the small "Country" label beside the pills (desktop only). */
  withLabel?: boolean;
}

/**
 * Sleek horizontal country pill bar (flags + names) for StreamPulse.
 *
 * Pills are laid out as `All Countries 🌐` → curated presets (Sri Lanka,
 * India, United States, United Kingdom) → every other country found in the
 * playlist. Selecting a pill filters the channel grid and search results
 * instantly, with an active glow state matching the category selector.
 */
export default function CountryFilter({
  countries,
  selected,
  onSelect,
  withLabel = true,
}: CountryFilterProps) {
  const options = useMemo(() => buildCountryOptions(countries), [countries]);

  const pillClass = (isActive: boolean) =>
    `flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold whitespace-nowrap border transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
      isActive
        ? "bg-gradient-to-r from-cyan-400 to-blue-600 text-black border-cyan-300 shadow-lg shadow-cyan-500/30 scale-[1.03]"
        : "bg-chip text-dim border-line hover:bg-glass2 hover:text-ink hover:border-line2 hover:-translate-y-0.5"
    }`;

  return (
    <div className="flex items-center gap-2.5 min-w-0">
      {withLabel && (
        <span className="hidden sm:flex items-center gap-1.5 flex-shrink-0 text-[11px] font-bold uppercase tracking-wider text-faint">
          <Globe className="w-3.5 h-3.5 text-cyan-400" />
          Country
        </span>
      )}

      <div
        role="group"
        aria-label="Filter channels by country"
        className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none scroll-smooth"
      >
        <button
          type="button"
          onClick={() => onSelect("All")}
          aria-pressed={selected === "All"}
          className={pillClass(selected === "All" || selected === "")}
        >
          <span className="text-sm leading-none">🌐</span>
          <span>All Countries</span>
        </button>

        {options.map((country: CountryInfo) => {
          const isActive = selected === country.code;
          return (
            <button
              key={country.code}
              type="button"
              onClick={() => onSelect(country.code)}
              aria-pressed={isActive}
              title={`Channels from ${country.name}`}
              className={pillClass(isActive)}
            >
              <span className="text-sm leading-none">{country.flag}</span>
              <span>{country.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
