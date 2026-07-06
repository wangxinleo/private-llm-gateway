"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type BadgeVariant = React.ComponentProps<typeof Badge>["variant"];

interface OverflowBadgesProps {
  items: string[];
  getVariant?: (item: string) => BadgeVariant;
  getLabel?: (item: string) => string;
  className?: string;
  badgeClassName?: string;
}

export function OverflowBadges({ items, getVariant, getLabel, className, badgeClassName }: OverflowBadgesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(0);

  const updateVisibleCount = useCallback(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const availableWidth = container.clientWidth;
    if (availableWidth <= 0 || items.length === 0) {
      setVisibleCount(0);
      return;
    }

    const badges = Array.from(measure.querySelectorAll<HTMLElement>("[data-overflow-badge]"));
    const moreBadge = measure.querySelector<HTMLElement>("[data-more-badge]");
    const measureStyle = getComputedStyle(measure);
    const gap = Number.parseFloat(measureStyle.columnGap || measureStyle.gap) || 0;
    const widths = badges.map((badge) => badge.offsetWidth);
    const moreWidth = moreBadge?.offsetWidth ?? 0;

    let count = 0;
    let visibleWidth = 0;

    for (const width of widths) {
      const nextWidth = visibleWidth + (count > 0 ? gap : 0) + width;
      if (nextWidth > availableWidth) break;
      visibleWidth = nextWidth;
      count += 1;
    }

    if (count < items.length) {
      while (count > 0 && visibleWidth + gap + moreWidth > availableWidth) {
        count -= 1;
        visibleWidth -= widths[count] + (count > 0 ? gap : 0);
      }
    }

    setVisibleCount((current) => (current === count ? current : count));
  }, [items]);

  useEffect(() => {
    updateVisibleCount();
  }, [updateVisibleCount]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(updateVisibleCount);
    observer.observe(container);
    return () => observer.disconnect();
  }, [updateVisibleCount]);

  const hiddenCount = Math.max(0, items.length - visibleCount);
  const baseBadgeClassName = cn("shrink-0 whitespace-nowrap font-mono text-xs", badgeClassName);

  return (
    <div ref={containerRef} className={cn("relative min-w-0 overflow-hidden", className)}>
      <div className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap">
        {items.slice(0, visibleCount).map((item, index) => (
          <Badge key={`${item}-${index}`} variant={getVariant?.(item) ?? "outline"} className={baseBadgeClassName}>
            {getLabel?.(item) ?? item}
          </Badge>
        ))}
        {hiddenCount > 0 ? (
          <Badge variant="outline" className={cn(baseBadgeClassName, "text-muted-foreground")}>
            +{hiddenCount}
          </Badge>
        ) : null}
      </div>
      <div ref={measureRef} aria-hidden="true" className="pointer-events-none absolute -left-[9999px] top-0 flex gap-1 opacity-0">
        {items.map((item, index) => (
          <Badge key={`${item}-${index}`} data-overflow-badge variant={getVariant?.(item) ?? "outline"} className={baseBadgeClassName}>
            {getLabel?.(item) ?? item}
          </Badge>
        ))}
        <Badge data-more-badge variant="outline" className={cn(baseBadgeClassName, "text-muted-foreground")}>
          +{items.length}
        </Badge>
      </div>
    </div>
  );
}
