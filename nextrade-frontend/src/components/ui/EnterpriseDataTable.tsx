import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  getFilteredRowModel, getPaginationRowModel, flexRender,
  ColumnDef, SortingState,
} from "@tanstack/react-table";
import { useState } from "react";
import { ArrowUp, ArrowDown, ChevronsUpDown, Search, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { useTranslation } from "react-i18next";

interface EnterpriseDataTableProps<TData> {
  data: TData[];
  columns: ColumnDef<TData, any>[];
  searchPlaceholder?: string;
  emptyMessage?: string;
  onRowClick?: (row: TData) => void;
  pageSize?: number;
}

export function EnterpriseDataTable<TData>({
  data, columns, searchPlaceholder, emptyMessage, onRowClick, pageSize = 15,
}: EnterpriseDataTableProps<TData>) {
  const { t } = useTranslation();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const table = useReactTable({
    data, columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const rows = table.getRowModel().rows;
  const filteredCount = table.getFilteredRowModel().rows.length;
  const { pageIndex } = table.getState().pagination;
  const start = pageIndex * pageSize + 1;
  const end = Math.min((pageIndex + 1) * pageSize, filteredCount);

  return (
    <div className="card overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 border-b border-surface-border bg-surface-page px-3 py-2">
        <div className="flex items-center gap-2 rounded border border-surface-border bg-white px-2.5 py-1.5 flex-1 max-w-xs focus-within:border-intel-500 transition-colors">
          <Search size={13} className="text-surface-muted flex-shrink-0" />
          <input
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder={searchPlaceholder ?? t("common.search")}
            className="w-full bg-transparent text-xs outline-none placeholder:text-surface-muted"
          />
        </div>
        <span className="text-2xs text-surface-muted ml-auto">
          {filteredCount > 0 ? `Showing ${start}–${end} of ${filteredCount} entries` : `${filteredCount} entries`}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-surface-border bg-surface-page">
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className={`px-3 py-2.5 text-left text-2xs font-semibold uppercase tracking-wider text-surface-muted select-none whitespace-nowrap ${header.column.getCanSort() ? "cursor-pointer hover:text-surface-text" : ""}`}
                  >
                    <span className="flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() === "asc" && <ArrowUp size={11} className="text-intel-500" />}
                      {header.column.getIsSorted() === "desc" && <ArrowDown size={11} className="text-intel-500" />}
                      {!header.column.getIsSorted() && header.column.getCanSort() && (
                        <ChevronsUpDown size={11} className="opacity-20" />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-surface-border">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-10 text-center text-sm text-surface-muted">
                  {emptyMessage ?? t("common.noData")}
                </td>
              </tr>
            ) : rows.map((row, idx) => (
              <tr
                key={row.id}
                onClick={() => onRowClick?.(row.original)}
                className={`transition-colors ${onRowClick ? "cursor-pointer hover:bg-surface-page" : ""} ${idx % 2 === 1 ? "bg-[#FAFBFC]" : "bg-white"}`}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-2.5 text-surface-text">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between border-t border-surface-border bg-surface-page px-3 py-2">
          <span className="text-2xs text-surface-muted">
            Halaman {pageIndex + 1} dari {table.getPageCount()}
          </span>
          <div className="flex items-center gap-1">
            <button onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}
              className="rounded border border-surface-border bg-white p-1 disabled:opacity-30 hover:bg-surface-page transition-colors">
              <ChevronsLeft size={13} />
            </button>
            <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}
              className="rounded border border-surface-border bg-white p-1 disabled:opacity-30 hover:bg-surface-page transition-colors">
              <ChevronLeft size={13} />
            </button>
            {/* Page number pills */}
            {Array.from({ length: Math.min(table.getPageCount(), 5) }).map((_, i) => {
              const pg = i + Math.max(0, pageIndex - 2);
              if (pg >= table.getPageCount()) return null;
              return (
                <button key={pg} onClick={() => table.setPageIndex(pg)}
                  className={`min-w-[28px] rounded border px-1.5 py-1 text-2xs transition-colors ${pg === pageIndex ? "border-intel-500 bg-intel-500 text-white" : "border-surface-border bg-white hover:bg-surface-page"}`}>
                  {pg + 1}
                </button>
              );
            })}
            <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}
              className="rounded border border-surface-border bg-white p-1 disabled:opacity-30 hover:bg-surface-page transition-colors">
              <ChevronRight size={13} />
            </button>
            <button onClick={() => table.setPageIndex(table.getPageCount() - 1)} disabled={!table.getCanNextPage()}
              className="rounded border border-surface-border bg-white p-1 disabled:opacity-30 hover:bg-surface-page transition-colors">
              <ChevronsRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
