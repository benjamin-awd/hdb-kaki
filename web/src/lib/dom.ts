// Tiny DOM helpers shared by the interactive pages' <script> blocks.
import { titleCase } from './format';

/** `document.getElementById(id)` with a non-null assertion — the ids are in the template. */
export const byId = (id: string): HTMLElement => document.getElementById(id)!;

/** Populate a street `<select>` with an "All streets" option plus one option per street. */
export function setStreets(selectEl: HTMLElement, streets: string[]): void {
  (selectEl as HTMLSelectElement).innerHTML =
    `<option value="__all" selected>All streets</option>` +
    streets.map((s) => `<option value="${s}">${titleCase(s)}</option>`).join('');
}
