/* @ts-self-types="./mathmap.d.ts" */

export class WasmUniverse {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmUniverseFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmuniverse_free(ptr, 0);
    }
    /**
     * @param {Float32Array | number[]} init_x
     * @param {Float32Array | number[]} init_y
     * @param {Float32Array | number[]} init_sx
     * @param {Float32Array | number[]} init_sy
     * @param {Float32Array | number[]} init_sz
     * @param {Float32Array | number[]} anchor_x
     * @param {Float32Array | number[]} anchor_y
     * @param {Float32Array | number[]} anchor_sx
     * @param {Float32Array | number[]} anchor_sy
     * @param {Float32Array | number[]} anchor_sz
     * @param {Float32Array | number[]} citations
     * @param {Uint16Array | number[]} field_idx
     * @param {Uint32Array | number[]} edge_u
     * @param {Uint32Array | number[]} edge_v
     * @param {Float32Array | number[]} edge_weight
     */
    load_graph(init_x, init_y, init_sx, init_sy, init_sz, anchor_x, anchor_y, anchor_sx, anchor_sy, anchor_sz, citations, field_idx, edge_u, edge_v, edge_weight) {
        let ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, ptr6, len6, ptr7, len7, ptr8, len8, ptr9, len9, ptr10, len10, ptr11, len11, ptr12, len12, ptr13, len13, ptr14, len14;
        try {
            ptr0 = passArrayF32ToWasm0(init_x, wasm.__wbindgen_malloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passArrayF32ToWasm0(init_y, wasm.__wbindgen_malloc);
            len1 = WASM_VECTOR_LEN;
            ptr2 = passArrayF32ToWasm0(init_sx, wasm.__wbindgen_malloc);
            len2 = WASM_VECTOR_LEN;
            ptr3 = passArrayF32ToWasm0(init_sy, wasm.__wbindgen_malloc);
            len3 = WASM_VECTOR_LEN;
            ptr4 = passArrayF32ToWasm0(init_sz, wasm.__wbindgen_malloc);
            len4 = WASM_VECTOR_LEN;
            ptr5 = passArrayF32ToWasm0(anchor_x, wasm.__wbindgen_malloc);
            len5 = WASM_VECTOR_LEN;
            ptr6 = passArrayF32ToWasm0(anchor_y, wasm.__wbindgen_malloc);
            len6 = WASM_VECTOR_LEN;
            ptr7 = passArrayF32ToWasm0(anchor_sx, wasm.__wbindgen_malloc);
            len7 = WASM_VECTOR_LEN;
            ptr8 = passArrayF32ToWasm0(anchor_sy, wasm.__wbindgen_malloc);
            len8 = WASM_VECTOR_LEN;
            ptr9 = passArrayF32ToWasm0(anchor_sz, wasm.__wbindgen_malloc);
            len9 = WASM_VECTOR_LEN;
            ptr10 = passArrayF32ToWasm0(citations, wasm.__wbindgen_malloc);
            len10 = WASM_VECTOR_LEN;
            ptr11 = passArray16ToWasm0(field_idx, wasm.__wbindgen_malloc);
            len11 = WASM_VECTOR_LEN;
            ptr12 = passArray32ToWasm0(edge_u, wasm.__wbindgen_malloc);
            len12 = WASM_VECTOR_LEN;
            ptr13 = passArray32ToWasm0(edge_v, wasm.__wbindgen_malloc);
            len13 = WASM_VECTOR_LEN;
            ptr14 = passArrayF32ToWasm0(edge_weight, wasm.__wbindgen_malloc);
            len14 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr14) { wasm.__wbindgen_free(ptr14, len14 * 4, 4); }
            if (ptr13) { wasm.__wbindgen_free(ptr13, len13 * 4, 4); }
            if (ptr12) { wasm.__wbindgen_free(ptr12, len12 * 4, 4); }
            if (ptr11) { wasm.__wbindgen_free(ptr11, len11 * 2, 2); }
            if (ptr10) { wasm.__wbindgen_free(ptr10, len10 * 4, 4); }
            if (ptr9) { wasm.__wbindgen_free(ptr9, len9 * 4, 4); }
            if (ptr8) { wasm.__wbindgen_free(ptr8, len8 * 4, 4); }
            if (ptr7) { wasm.__wbindgen_free(ptr7, len7 * 4, 4); }
            if (ptr6) { wasm.__wbindgen_free(ptr6, len6 * 4, 4); }
            if (ptr5) { wasm.__wbindgen_free(ptr5, len5 * 4, 4); }
            if (ptr4) { wasm.__wbindgen_free(ptr4, len4 * 4, 4); }
            if (ptr3) { wasm.__wbindgen_free(ptr3, len3 * 4, 4); }
            if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 4, 4); }
            if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 4, 4); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 4, 4); }
            throw e;
        }
        wasm.wasmuniverse_load_graph(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, ptr6, len6, ptr7, len7, ptr8, len8, ptr9, len9, ptr10, len10, ptr11, len11, ptr12, len12, ptr13, len13, ptr14, len14);
    }
    /**
     * @param {number} idx
     * @param {number} x
     * @param {number} y
     */
    move_node_2d(idx, x, y) {
        wasm.wasmuniverse_move_node_2d(this.__wbg_ptr, idx, x, y);
    }
    /**
     * @param {number} idx
     * @param {number} sx
     * @param {number} sy
     * @param {number} sz
     */
    move_node_3d(idx, sx, sy, sz) {
        wasm.wasmuniverse_move_node_3d(this.__wbg_ptr, idx, sx, sy, sz);
    }
    constructor() {
        const ret = wasm.wasmuniverse_new();
        this.__wbg_ptr = ret;
        WasmUniverseFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    node_count() {
        const ret = wasm.wasmuniverse_node_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    r_ptr() {
        const ret = wasm.wasmuniverse_r_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    reheat() {
        wasm.wasmuniverse_reheat(this.__wbg_ptr);
    }
    /**
     * @param {number} seed
     * @param {boolean} is_globe
     */
    scramble(seed, is_globe) {
        wasm.wasmuniverse_scramble(this.__wbg_ptr, seed, is_globe);
    }
    /**
     * @param {number} idx
     */
    set_dragged_node(idx) {
        wasm.wasmuniverse_set_dragged_node(this.__wbg_ptr, idx);
    }
    /**
     * @param {string} key
     * @param {number} val
     */
    set_param(key, val) {
        const val2 = +val;
        const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.wasmuniverse_set_param(this.__wbg_ptr, ptr0, len0, val2);
    }
    /**
     * @param {boolean} is_globe
     */
    set_view_mode(is_globe) {
        wasm.wasmuniverse_set_view_mode(this.__wbg_ptr, is_globe);
    }
    /**
     * @param {number} steps
     * @returns {number}
     */
    step(steps) {
        const ret = wasm.wasmuniverse_step(this.__wbg_ptr, steps);
        return ret;
    }
    /**
     * @returns {number}
     */
    sx_ptr() {
        const ret = wasm.wasmuniverse_sx_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    sy_ptr() {
        const ret = wasm.wasmuniverse_sy_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    sz_ptr() {
        const ret = wasm.wasmuniverse_sz_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    temperature() {
        const ret = wasm.wasmuniverse_temperature(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    x_ptr() {
        const ret = wasm.wasmuniverse_x_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    y_ptr() {
        const ret = wasm.wasmuniverse_y_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) WasmUniverse.prototype[Symbol.dispose] = WasmUniverse.prototype.free;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_4c88d8bf264fd984: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            table.set(0, undefined);
            table.set(1024, undefined);
            table.set(1025, null);
            table.set(1026, true);
            table.set(1027, false);
        },
    };
    return {
        __proto__: null,
        "./mathmap_bg.js": import0,
    };
}

const WasmUniverseFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmuniverse_free(ptr, 1));

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let cachedUint16ArrayMemory0 = null;
function getUint16ArrayMemory0() {
    if (cachedUint16ArrayMemory0 === null || cachedUint16ArrayMemory0.byteLength === 0) {
        cachedUint16ArrayMemory0 = new Uint16Array(wasm.memory.buffer);
    }
    return cachedUint16ArrayMemory0;
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray16ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 2, 2) >>> 0;
    getUint16ArrayMemory0().set(arg, ptr / 2);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(bytes) {
    numBytesDecoded += bytes.length;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
        cachedTextDecoder.decode();
        numBytesDecoded = bytes.length;
    }
    return cachedTextDecoder.decode(bytes);
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat32ArrayMemory0 = null;
    cachedUint16ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

let __wbg_init_promise;
async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;
    if (__wbg_init_promise === undefined) {
        __wbg_init_promise = __wbg_init_once(module_or_path);
        __wbg_init_promise.catch(() => { __wbg_init_promise = undefined; });
    }
    return __wbg_init_promise;
}

async function __wbg_init_once(module_or_path) {

    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('mathmap_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
