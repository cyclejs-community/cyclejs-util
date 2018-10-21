import xs, { Stream } from 'xstream';
import { Instances, Lens } from '@cycle/state';

type MergeArguments<T, K extends string = "whatever"> =
    {
        [Key in K]: T extends (first: infer A) => void ? A :
        MergeOnePlus<T, K>
    }[K];

type MergeOnePlus<T, K extends string> =
    {
        [Key in K]: T extends (first: infer A, ...args: infer U) => void
        ? A & MergeArguments<(...args: U) => void, K>
        : never
    }[K];

type IntoSignature<T extends unknown[]> = (...args: T) => void;

type MergeTupleMembers<T extends unknown[]> = MergeArguments<IntoSignature<T>>;

export type MergeExceptions<Si> = {
    [k in keyof Si]?: (s: Si[k][]) => Si[k];
};

/**
 * Applies xs.merge to all sinks in the array
 * @param  {Sinks[]} sinks    the sinks to be merged
 * @param  {MergeExceptions}  exceptions a dictionary of special channels, e.g. DOM
 * @return {Sinks}            the new unified sink
 */
export function mergeSinks<T extends [any, ...any[]]>(
    sinks: T,
    exceptions: MergeExceptions<MergeTupleMembers<T>> = {}
): MergeTupleMembers<T> {
    const drivers: string[] = sinks
        .map(Object.keys)
        .reduce((acc, curr) => acc.concat(curr), [])
        .reduce(
            (acc, curr) => (acc.indexOf(curr) === -1 ? [...acc, curr] : acc),
            []
        );

    const emptySinks: any = drivers
        .map(s => ({ [s]: [] } as any))
        .reduce((acc, curr) => Object.assign(acc, curr), {});

    const combinedSinks = sinks.reduce((acc, curr) => {
        return Object.keys(acc)
            .map(s => ({ [s]: acc[s] }))
            .map(o => {
                const name: string = Object.keys(o)[0];
                return !curr[name]
                    ? o
                    : {
                        [name]: [...o[name], curr[name]]
                    };
            })
            .reduce((a, c) => Object.assign(a, c), {});
    }, emptySinks);

    const merged: any = Object.keys(combinedSinks)
        .filter(name => Object.keys(exceptions).indexOf(name) === -1)
        .map(s => [s, combinedSinks[s]])
        .map(([s, arr]) => ({
            [s]: arr.length === 1 ? arr[0] : xs.merge(...arr)
        }));

    const special = Object.keys(exceptions)
        .map(key => [key, combinedSinks[key]])
        .filter(([_, arr]) => arr !== undefined)
        .map(([key, arr]) => ({ [key]: exceptions[key](arr) }));

    return merged
        .concat(special)
        .reduce((acc, curr) => Object.assign(acc, curr), {});
}

export type PickMergeExceptions = {
    [k: string]: (ins: Instances<any>) => Stream<any>;
};

/**
 * Just like mergeSinks, but for onionify collections
 * @see mergeSinks
 */
export function pickMergeSinks(
    driverNames: string[],
    exceptions: PickMergeExceptions = {}
): (ins: Instances<any>) => any {
    return instances => {
        const merged: any = driverNames
            .filter(name => Object.keys(exceptions).indexOf(name) === -1)
            .map(name => ({ [name]: instances.pickMerge(name) }));

        const special = Object.keys(exceptions).map(key => ({
            [key]: exceptions[key](instances)
        }));

        return merged
            .concat(special)
            .reduce((acc, curr) => Object.assign(acc, curr), {});
    };
}

/**
 * Extracts the sinks from a Stream of Sinks
 * @param  {Stream<Sinks>} sinks$
 * @param  {string[]}      driverNames the names of all drivers that are possibly in the stream, it's best to use Object.keys() on your driver object
 * @return {Sinks}                     A sinks containing the streams of the last emission in the sinks$
 */
export function extractSinks<Si>(
    sinks$: Stream<Si>,
    driverNames: string[]
): { [k in keyof Si]: Stream<Si[k]> } {
    return driverNames
        .map(d => ({
            [d]: sinks$
                .map<any>(s => s[d])
                .filter(b => !!b)
                .flatten()
        }))
        .reduce((acc, curr) => Object.assign(acc, curr), {}) as any;
}

/**
 * Can be used to load a component lazy (with webpack code splitting)
 * @param  {() => any} moduleLoader A function like `() => import('./myModule')`
 * @param  {string[]} driverNames The names of the drivers the lazy component uses
 * @param  {string} name The name of the export. For loading a default export simply ignore
 * @return {Component} A dummy that loads the actual component
 */
export function loadAsync(
    moduleLoader: () => Promise<any>,
    driverNames: string[],
    name: string = 'default'
): (s: any) => any {
    return sources => {
        const lazyComponent$: Stream<any> = xs
            .fromPromise(moduleLoader())
            .map(m => m[name])
            .map(m => m(sources));

        return extractSinks(lazyComponent$, driverNames);
    };
}

/**
 * Composes two lenses to one
 * @param {Lens<A, B>} outer
 * @param {Lens<B, C>} inner
 * @return {Lens<A, C>} composed lens
 */
export function composeLenses<A, B, C>(
    outer: Lens<A, B>,
    inner: Lens<B, C>
): Lens<A, C> {
    return {
        get: parent => inner.get(outer.get(parent)),
        set: (parent, child) =>
            outer.set(parent, inner.set(outer.get(parent), child))
    };
}
