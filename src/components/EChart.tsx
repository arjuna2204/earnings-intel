"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import {
  GridComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  DataZoomComponent,
  LegendComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  LineChart,
  BarChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  MarkPointComponent,
  MarkLineComponent,
  DataZoomComponent,
  LegendComponent,
  CanvasRenderer,
]);

const FONT = '"Geist Variable", ui-sans-serif, system-ui, sans-serif';

type Props = {
  option: echarts.EChartsCoreOption;
  className?: string;
  onClick?: (params: { dataIndex: number; seriesIndex?: number; componentType?: string; name?: string }) => void;
  ariaLabel: string;
  /** Called with the category index under the pointer (axis tooltip charts), or null when it leaves. */
  onHoverIndex?: (index: number | null) => void;
};

/** Thin ECharts wrapper: one chart instance per element, resized with its container. */
export default function EChart({ option, className, onClick, ariaLabel, onHoverIndex }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const clickRef = useRef(onClick);
  const hoverRef = useRef(onHoverIndex);
  useLayoutEffect(() => {
    clickRef.current = onClick;
    hoverRef.current = onHoverIndex;
  });

  useEffect(() => {
    if (!ref.current) return;
    const c = echarts.init(ref.current, undefined, { renderer: "canvas" });
    chart.current = c;
    c.on("click", (p) => clickRef.current?.(p as { dataIndex: number }));
    c.on("updateAxisPointer", (e) => {
      const info = (e as { axesInfo?: { value: number }[] }).axesInfo?.[0];
      hoverRef.current?.(info ? Number(info.value) : null);
    });
    c.getZr().on("globalout", () => hoverRef.current?.(null));
    // touch: lifting the finger ends a scrub and returns to the latest value
    const el = ref.current;
    const release = () => {
      c.dispatchAction({ type: "hideTip" });
      c.dispatchAction({ type: "updateAxisPointer", currTrigger: "leave" });
      hoverRef.current?.(null);
    };
    el.addEventListener("touchend", release, { passive: true });
    el.addEventListener("touchcancel", release, { passive: true });
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      el.removeEventListener("touchend", release);
      el.removeEventListener("touchcancel", release);
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption({ textStyle: { fontFamily: FONT }, ...option }, { notMerge: true });
  }, [option]);

  return <div ref={ref} role="img" aria-label={ariaLabel} className={className} />;
}
