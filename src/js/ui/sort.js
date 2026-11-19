/**
 * @file Click-to-sort, shared by every sortable list: the Historique and Par objet tables
 * (sortable headers) and the En cours cards (a sort bar).
 *
 * A view keeps its own `{key, dir}` and its columns; a click on a column's button sorts
 * by it, in its `first` direction, and a second click reverses the order.
 */

import { esc } from "./dom.js";

/**
 * @template T
 * @typedef {Object} SortColumn
 * @property {string} key
 * @property {string} label
 * @property {(row: T) => string|number} value  what the rows are sorted by
 * @property {1|-1} [first]  direction of the first click: 1 ascending (default for text), -1 descending
 * @property {boolean} [numeric]  right-aligned in a table
 */

/** @typedef {{key: string, dir: number}} SortState */

/**
 * @template T
 * @param {SortColumn<T>} column
 */
const firstDir = (column) => column.first ?? (column.numeric ? -1 : 1);

/**
 * The rows sorted by the sort's column, `tiebreak` deciding between equal values.
 * @template T
 * @param {T[]} rows
 * @param {SortColumn<T>[]} columns
 * @param {SortState} sort
 * @param {(a: T, b: T) => number} [tiebreak]
 * @returns {T[]}
 */
export function sortRows(rows, columns, sort, tiebreak = () => 0) {
  const { value } = columns.find((c) => c.key === sort.key) ?? columns[0];
  return [...rows].sort((a, b) => {
    const x = value(a),
      y = value(b);
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || tiebreak(a, b);
  });
}

/**
 * The sort after a click on `key`: reversed when it is already the sort, else its first direction.
 * @template T
 * @param {SortState} sort
 * @param {string} key
 * @param {SortColumn<T>[]} columns
 * @returns {SortState}
 */
export function nextSort(sort, key, columns) {
  const column = columns.find((c) => c.key === key);
  if (!column) return sort;
  return { key, dir: sort.key === key ? -sort.dir : firstDir(column) };
}

/**
 * A column's sort button, with an arrow when it is the sort.
 * @template T
 * @param {SortColumn<T>} column
 * @param {SortState} sort
 */
export function sortButton(column, sort) {
  const active = sort.key === column.key;
  return `<button type="button" class="th-btn${active ? " on" : ""}" data-sort="${esc(column.key)}">${esc(column.label)}${active ? (sort.dir > 0 ? " ↑" : " ↓") : ""}</button>`;
}

/**
 * A table's header row: one sortable `<th>` per column.
 * @template T
 * @param {SortColumn<T>[]} columns
 * @param {SortState} sort
 */
export function sortHeader(columns, sort) {
  return `<tr>${columns
    .map((column) => {
      const active = sort.key === column.key;
      const aria = active ? (sort.dir > 0 ? "ascending" : "descending") : "none";
      return `<th class="${column.numeric ? "n" : ""}" aria-sort="${aria}">${sortButton(column, sort)}</th>`;
    })
    .join("")}</tr>`;
}
