/* tslint:disable */
/* eslint-disable */

export class WasmUniverse {
    free(): void;
    [Symbol.dispose](): void;
    freeze(): void;
    load_graph(init_x: Float32Array | number[], init_y: Float32Array | number[], init_sx: Float32Array | number[], init_sy: Float32Array | number[], init_sz: Float32Array | number[], anchor_x: Float32Array | number[], anchor_y: Float32Array | number[], anchor_sx: Float32Array | number[], anchor_sy: Float32Array | number[], anchor_sz: Float32Array | number[], citations: Float32Array | number[], field_idx: Uint16Array | number[], edge_u: Uint32Array | number[], edge_v: Uint32Array | number[], edge_weight: Float32Array | number[]): void;
    move_node_2d(idx: number, x: number, y: number): void;
    move_node_3d(idx: number, sx: number, sy: number, sz: number): void;
    constructor();
    node_count(): number;
    r_ptr(): number;
    reheat(): void;
    scramble(seed: number, is_globe: boolean): void;
    set_dragged_node(idx: number): void;
    set_param(key: string, val: number): void;
    set_view_mode(is_globe: boolean): void;
    step(steps: number): number;
    sx_ptr(): number;
    sy_ptr(): number;
    sz_ptr(): number;
    temperature(): number;
    x_ptr(): number;
    y_ptr(): number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmuniverse_free: (a: number, b: number) => void;
    readonly wasmuniverse_freeze: (a: number) => void;
    readonly wasmuniverse_load_graph: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number, v: number, w: number, x: number, y: number, z: number, a1: number, b1: number, c1: number, d1: number, e1: number) => void;
    readonly wasmuniverse_move_node_2d: (a: number, b: number, c: number, d: number) => void;
    readonly wasmuniverse_move_node_3d: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wasmuniverse_new: () => number;
    readonly wasmuniverse_node_count: (a: number) => number;
    readonly wasmuniverse_r_ptr: (a: number) => number;
    readonly wasmuniverse_reheat: (a: number) => void;
    readonly wasmuniverse_scramble: (a: number, b: number, c: number) => void;
    readonly wasmuniverse_set_dragged_node: (a: number, b: number) => void;
    readonly wasmuniverse_set_param: (a: number, b: number, c: number, d: number) => void;
    readonly wasmuniverse_set_view_mode: (a: number, b: number) => void;
    readonly wasmuniverse_step: (a: number, b: number) => number;
    readonly wasmuniverse_sx_ptr: (a: number) => number;
    readonly wasmuniverse_sy_ptr: (a: number) => number;
    readonly wasmuniverse_sz_ptr: (a: number) => number;
    readonly wasmuniverse_temperature: (a: number) => number;
    readonly wasmuniverse_x_ptr: (a: number) => number;
    readonly wasmuniverse_y_ptr: (a: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
