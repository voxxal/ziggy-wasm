interface ParseOptions {
    literals?: {
        [k: string]: (v: string) => any;
    };
}
export declare const parse: (source: string, options?: ParseOptions) => any;
export {};
