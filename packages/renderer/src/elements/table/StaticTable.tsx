'use client';

import { useMemo, type CSSProperties } from 'react';
import type { PPTTableElement, TableCellBorder } from '@shikshasetu/dsl';
import { getTableSubThemeColor } from '../../utils/element';
import { getTextStyle } from './tableUtils';

function cellBorderCss(b?: TableCellBorder): string | undefined {
  if (!b || b.width <= 0) return undefined;
  const style = b.style === 'dashed' || b.style === 'dotted' ? b.style : 'solid';
  return `${b.width}px ${style} ${b.color}`;
}

interface StaticTableProps {
  elementInfo: PPTTableElement;
}

export function StaticTable({ elementInfo }: StaticTableProps) {
  const { width, data, colWidths, cellMinHeight, rowHeights, outline, theme } = elementInfo;

  const [subThemeDark, subThemeLight] = useMemo(() => {
    if (!theme) return ['', ''];
    return getTableSubThemeColor(theme.color);
  }, [theme]);

  const borderStyle = useMemo(() => {
    if (!outline) return 'none';
    const w = outline.width ?? 1;
    const c = outline.color ?? '#000';
    const s = outline.style === 'dashed' ? 'dashed' : 'solid';
    return `${w}px ${s} ${c}`;
  }, [outline]);

  const getCellBg = (
    rowIdx: number,
    colIdx: number,
    cellBackcolor?: string,
  ): string | undefined => {
    if (cellBackcolor) return cellBackcolor;
    if (!theme) return undefined;

    const rowCount = data.length;
    const colCount = data[0]?.length ?? 0;

    if (theme.rowHeader && rowIdx === 0) return theme.color;
    if (theme.rowFooter && rowIdx === rowCount - 1) return theme.color;
    if (theme.colHeader && colIdx === 0) return subThemeDark;
    if (theme.colFooter && colIdx === colCount - 1) return subThemeDark;

    const effectiveRow = theme.rowHeader ? rowIdx - 1 : rowIdx;
    if (effectiveRow >= 0 && effectiveRow % 2 === 0) return subThemeLight;

    return undefined;
  };

  const getHeaderTextColor = (rowIdx: number): string | undefined => {
    if (!theme) return undefined;
    const rowCount = data.length;
    if (theme.rowHeader && rowIdx === 0) return '#fff';
    if (theme.rowFooter && rowIdx === rowCount - 1) return '#fff';
    return undefined;
  };

  return (
    <table
      className="slide-renderer-prose"
      style={{
        width: '100%',
        height: '100%',
        borderCollapse: 'collapse',
        tableLayout: 'fixed',
      }}
    >
      <colgroup>
        {colWidths.map((w, i) => (
          <col key={i} style={{ width: `${w * width}px` }} />
        ))}
      </colgroup>
      <tbody>
        {data.map((row, rowIdx) => (
          <tr key={rowIdx} style={{ height: `${rowHeights?.[rowIdx] ?? cellMinHeight}px` }}>
            {row.map((cell, colIdx) => {
              // The parser side (transformParsedToSlides) already strips
              // hMerge/vMerge continuation cells, so data[r] only holds
              // top-left cells; the browser's HTML table layout works out the
              // correct position via td.colSpan/rowSpan automatically, so
              // hiddenCells don't need to be computed by hand here (an older
              // implementation compared data-index against grid-coord keys,
              // mixing two coordinate systems, which could wrongly hide a
              // cell whenever a colspan's grid-coord collided with another
              // cell's data-index).
              const bgColor = getCellBg(rowIdx, colIdx, cell.style?.backcolor);
              const headerColor = getHeaderTextColor(rowIdx);
              const textStyle = getTextStyle(cell.style);

              if (headerColor && !cell.style?.color) {
                textStyle.color = headerColor;
              }

              // When a cell carries its own per-edge borders, render edge by
              // edge (an undefined edge draws nothing); otherwise fall back to
              // the old table-level outline-on-all-four-sides behavior, so a
              // genuine grid table still renders the way it used to.
              const cellBorders = cell.borders;
              const borderCss: CSSProperties =
                cellBorders &&
                (cellBorders.top || cellBorders.bottom || cellBorders.left || cellBorders.right)
                  ? {
                      borderTop: cellBorderCss(cellBorders.top) ?? 'none',
                      borderBottom: cellBorderCss(cellBorders.bottom) ?? 'none',
                      borderLeft: cellBorderCss(cellBorders.left) ?? 'none',
                      borderRight: cellBorderCss(cellBorders.right) ?? 'none',
                    }
                  : { border: borderStyle };

              return (
                <td
                  key={cell.id}
                  colSpan={cell.colspan > 1 ? cell.colspan : undefined}
                  rowSpan={cell.rowspan > 1 ? cell.rowspan : undefined}
                  style={{
                    ...borderCss,
                    backgroundColor: bgColor,
                    ...textStyle,
                  }}
                >
                  <div
                    className="slide-renderer-cell-text"
                    style={{
                      minHeight: `${(rowHeights?.[rowIdx] ?? cellMinHeight) - 4}px`,
                      padding: cell.padding,
                      display: 'flex',
                      flexDirection: 'column',
                      lineHeight: 1,
                      justifyContent:
                        cell.vAlign === 'top'
                          ? 'flex-start'
                          : cell.vAlign === 'bottom'
                            ? 'flex-end'
                            : 'center',
                    }}
                    // cell.text is already final HTML (transformParsedToSlides
                    // escapes text + converts \n/spaces and keeps <p> positioning
                    // styles). Do NOT run formatText here — its space→&nbsp;
                    // replacement corrupts style attributes like
                    // `margin-left: calc(42px + 0.25em)` → the title indent is
                    // lost and collides with the cell's left icon (slide 5).
                    dangerouslySetInnerHTML={{ __html: cell.text }}
                  />
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
