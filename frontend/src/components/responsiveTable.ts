import type { SxProps, Theme } from "@mui/material/styles";

/** Class for a free-text body cell (property / insurer / assignee name, task title) that
 * may wrap inside a `DATA_TABLE_SX` table. Pair it with `NAME_CELL_SX` / `TITLE_CELL_SX`
 * so a squeezed column still keeps a readable measure. */
export const WRAP_CELL_CLASS = "rmis-cell-wrap";

/** Shared `sx` for the list tables (incidents / claims / policies / mitigation).
 *
 * Token-like body cells (codes, amounts, dates, status chips, row actions) never wrap:
 * squeezed, a phone used to break "INC-2026-012" over three lines and amounts mid-number.
 * Only the free-text name columns (`WRAP_CELL_CLASS`) wrap, so the table stays as narrow
 * as possible and its `TableContainer` scrolls sideways only once that isn't enough.
 *
 * On touch screens the `size="small"` row-action icon buttons (30px) are padded up to a
 * 40px tap target; mouse layouts keep the compact size. */
export const DATA_TABLE_SX: SxProps<Theme> = {
  [`& .MuiTableCell-body:not(.${WRAP_CELL_CLASS})`]: { whiteSpace: "nowrap" },
  // Tighter gutters below `xl` (tablets / laptops): 8–10 columns then fit, or need
  // far less sideways scroll, without wrapping any value.
  "& .MuiTableCell-root": { paddingInline: { xs: "10px", xl: "16px" } },
  "@media (pointer: coarse)": {
    "& .MuiTableCell-body .MuiIconButton-sizeSmall": { padding: "10px" },
  },
};

export const NAME_CELL_SX: SxProps<Theme> = { minWidth: 120 };
export const TITLE_CELL_SX: SxProps<Theme> = { minWidth: 180 };
