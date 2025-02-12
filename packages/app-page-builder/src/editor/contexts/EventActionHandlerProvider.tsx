import { useApolloClient } from "@apollo/react-hooks";
import React, { createContext, useEffect, useMemo, useRef } from "react";
import merge from "lodash/merge";
import { plugins } from "@webiny/plugins";
import {
    rootElementAtom,
    elementsAtom,
    pageAtom,
    pluginsAtom,
    revisionsAtom,
    sidebarAtom,
    uiAtom,
    elementByIdSelector,
    activeElementAtom,
    highlightElementAtom,
    SidebarAtomType,
    RootElementAtom,
    PageAtomType,
    PluginsAtomType,
    UiAtomType,
    RevisionsAtomType
} from "../recoil/modules";

import { PbState } from "../recoil/modules/types";
import { EventAction } from "~/editor/recoil/eventActions";
import {
    EventActionHandlerCallableArgs,
    EventActionCallable,
    EventActionHandlerActionCallableResponse,
    EventActionHandlerConfig,
    PbConfigPluginType,
    PbConfigType,
    PbEditorElement,
    EventActionHandler,
    EventActionHandlerTarget,
    EventActionHandlerCallableState
} from "~/types";
import {
    Snapshot,
    useGotoRecoilSnapshot,
    useRecoilCallback,
    useRecoilSnapshot,
    useRecoilState,
    useRecoilValue,
    useSetRecoilState
} from "recoil";

type ListType = Map<symbol, EventActionCallable>;
type RegistryType = Map<string, ListType>;

interface SnapshotHistory {
    past: Snapshot[];
    future: Snapshot[];
    busy: boolean;
    present: Snapshot | null;
    isBatching: boolean;
    isDisabled: boolean;
}

export const EventActionHandlerContext = createContext<EventActionHandler>({
    trigger: async () => {
        return {};
    },
    on: () => {
        return () => {
            return true;
        };
    },
    redo: () => {
        return void 0;
    },
    enableHistory: () => {
        return void 0;
    },
    undo: () => {
        return void 0;
    },
    startBatch: () => {
        return void 0;
    },
    endBatch: () => {
        return void 0;
    },
    disableHistory: () => {
        return void 0;
    },
    getElementTree: async () => {
        return null as unknown as PbEditorElement;
    }
});

const createConfiguration = (plugins: PbConfigPluginType[]): PbConfigType => {
    return plugins.reduce(
        (acc, pl) => {
            return merge(acc, pl.config());
        },
        { maxEventActionsNesting: 5 }
    );
};

const getEventActionClassName = (target: EventActionHandlerTarget): string => {
    const cls = new target();
    const name = cls.getName();
    if (!name) {
        throw new Error("Could not find class name.");
    }
    return name;
};

const trackedAtoms: (keyof PbState)[] = ["elements"];
const isTrackedAtomChanged = (state: Partial<PbState>): boolean => {
    for (const atom of trackedAtoms) {
        if (!state[atom]) {
            continue;
        }
        return true;
    }
    return false;
};

export const EventActionHandlerProvider: React.FC<any> = ({ children }) => {
    const apolloClient = useApolloClient();
    const setActiveElementAtomValue = useSetRecoilState(activeElementAtom);
    const setHighlightElementAtomValue = useSetRecoilState(highlightElementAtom);
    const [sidebarAtomValue, setSidebarAtomValue] = useRecoilState(sidebarAtom);
    const rootElementAtomValue = useRecoilValue(rootElementAtom);
    const [pageAtomValue, setPageAtomValue] = useRecoilState(pageAtom);
    const [pluginsAtomValue, setPluginsAtomValue] = useRecoilState(pluginsAtom);
    const [uiAtomValue, setUiAtomValue] = useRecoilState(uiAtom);
    const revisionsAtomValue = useRecoilValue(revisionsAtom);
    const snapshot = useRecoilSnapshot();

    const eventActionHandlerRef = useRef<EventActionHandler>();
    const sidebarAtomValueRef = useRef<SidebarAtomType>();
    const rootElementAtomValueRef = useRef<RootElementAtom>();
    const pageAtomValueRef = useRef<PageAtomType>();
    const pluginsAtomValueRef = useRef<PluginsAtomType>();
    const uiAtomValueRef = useRef<UiAtomType>();
    const revisionsAtomValueRef = useRef<RevisionsAtomType>();
    const snapshotRef = useRef<Snapshot>();
    const eventElements = useRef<Record<string, PbEditorElement>>({});
    const snapshotsHistory = useRef<SnapshotHistory>({
        past: [],
        future: [],
        present: null,
        busy: false,
        isBatching: false,
        isDisabled: false
    });
    const goToSnapshot = useGotoRecoilSnapshot();

    useEffect(() => {
        sidebarAtomValueRef.current = sidebarAtomValue;
        rootElementAtomValueRef.current = rootElementAtomValue;
        pageAtomValueRef.current = pageAtomValue;
        pluginsAtomValueRef.current = pluginsAtomValue;
        uiAtomValueRef.current = uiAtomValue;
        revisionsAtomValueRef.current = revisionsAtomValue;
        snapshotRef.current = snapshot;
    }, [
        sidebarAtomValue,
        rootElementAtomValue,
        pageAtomValue,
        pluginsAtomValue,
        uiAtomValue,
        revisionsAtomValue
    ]);

    const registry = useRef<RegistryType>(new Map());

    const config = useRef<EventActionHandlerConfig>(
        createConfiguration(plugins.byType("pb-config"))
    );

    const updateElements = useRecoilCallback(({ set }) => (elements: PbEditorElement[] = []) => {
        elements.forEach(item => {
            set(elementsAtom(item.id), prevValue => {
                if (!prevValue) {
                    return {
                        ...item
                    };
                }
                return {
                    ...prevValue,
                    ...item,
                    parent: item.parent !== undefined ? item.parent : prevValue.parent
                };
            });
            return item.id;
        });
    });

    const takeSnapshot = useRecoilCallback(({ snapshot }) => () => {
        return snapshot;
    });

    const getElementTree = async (
        element?: PbEditorElement,
        path: string[] = []
    ): Promise<PbEditorElement> => {
        if (!element) {
            element = (await getElementById(rootElementAtomValue)) as PbEditorElement;
        }
        if (element.parent) {
            path.push(element.parent);
        }
        return {
            id: element.id,
            type: element.type,
            data: element.data,
            elements: await Promise.all(
                /**
                 * We are positive that element.elements is array of strings.
                 */
                (element.elements as string[]).map(async child => {
                    return getElementTree((await getElementById(child)) as PbEditorElement, [
                        ...path
                    ]);
                })
            ),
            path
        };
    };

    const get = (name: string): ListType => {
        const list = registry.current.get(name);
        if (!list) {
            throw new Error(`There is no event action group "${name}" defined.`);
        }
        return list;
    };

    const set = (name: string, list: ListType): void => {
        registry.current.set(name, list);
    };

    const has = (name: string): boolean => {
        return registry.current.has(name);
    };

    const hasCb = (list: ListType, callable: EventActionCallable): boolean => {
        const values = Array.from(list.values());
        return values.some(cb => cb === callable);
    };

    const off = (id: symbol): boolean => {
        const registryItems = Array.from(registry.current.values());
        for (const list of registryItems) {
            if (!list.has(id)) {
                continue;
            }
            return list.delete(id);
        }
        return false;
    };

    const getElementById = async (id: string): Promise<PbEditorElement> => {
        if (eventElements.current.hasOwnProperty(id)) {
            return eventElements.current[id];
        }
        return (snapshotRef.current as Snapshot).getPromise(
            elementByIdSelector(id)
        ) as Promise<PbEditorElement>;
    };

    const getCallableState = (
        state: Partial<EventActionHandlerCallableState>
    ): EventActionHandlerCallableState => {
        return {
            sidebar: sidebarAtomValueRef.current as SidebarAtomType,
            rootElement: rootElementAtomValueRef.current as RootElementAtom,
            page: pageAtomValueRef.current as PageAtomType,
            plugins: pluginsAtomValueRef.current as PluginsAtomType,
            ui: uiAtomValueRef.current as UiAtomType,
            revisions: revisionsAtomValueRef.current as RevisionsAtomType,
            getElementById,
            getElementTree,
            ...state
        };
    };

    const createStateHistorySnapshot = (): void => {
        if (snapshotsHistory.current.busy === true) {
            return;
        }
        snapshotsHistory.current.busy = true;
        // when saving new state history we must remove everything after the current one
        // since this is the new starting point of the state history
        snapshotsHistory.current.future = [];
        snapshotsHistory.current.past.push(takeSnapshot());
        snapshotsHistory.current.present = null;
        snapshotsHistory.current.busy = false;
    };

    const saveCallablesResults = (state: Partial<PbState>, history = true): void => {
        if (Object.values(state).length === 0) {
            return;
        } else if (
            history &&
            snapshotsHistory.current.isBatching === false &&
            snapshotsHistory.current.isDisabled === false &&
            isTrackedAtomChanged(state)
        ) {
            createStateHistorySnapshot();
        }

        if (state.ui) {
            setUiAtomValue(state.ui);
        }

        if (state.plugins) {
            setPluginsAtomValue(state.plugins);
        }

        if (state.page) {
            setPageAtomValue(state.page);
        }

        if (state.hasOwnProperty("activeElement")) {
            setActiveElementAtomValue(state.activeElement as string);
        }

        if (state.hasOwnProperty("highlightElement")) {
            setHighlightElementAtomValue(state.highlightElement as string);
        }

        if (state.elements) {
            updateElements(Object.values(state.elements));
        }

        if (state.sidebar) {
            setSidebarAtomValue(state.sidebar);
        }
    };

    eventActionHandlerRef.current = useMemo<EventActionHandler>(
        () => ({
            getElementTree,
            on: (target, callable) => {
                const name = getEventActionClassName(target);
                if (!has(name)) {
                    set(name, new Map());
                }
                const events = get(name);
                if (hasCb(events, callable)) {
                    throw new Error(
                        `You cannot register event action "${name}" with identical function that already is registered.`
                    );
                }

                const id = Symbol(`eventActionCb:${name}`);
                events.set(id, callable);
                return () => {
                    return off(id);
                };
            },
            trigger: async ev => {
                const results = await triggerEventAction(ev, {} as unknown as PbState, []);
                saveCallablesResults(results.state || {});
                return results.state || {};
            },
            undo: () => {
                if (snapshotsHistory.current.busy === true) {
                    return;
                }
                snapshotsHistory.current.busy = true;
                const previousSnapshot = snapshotsHistory.current.past.pop();
                if (!previousSnapshot) {
                    snapshotsHistory.current.busy = false;
                    return;
                }
                const futureSnapshot = snapshotsHistory.current.present || takeSnapshot();
                snapshotsHistory.current.future.unshift(futureSnapshot);

                snapshotsHistory.current.present = previousSnapshot;

                goToSnapshot(previousSnapshot);
                snapshotsHistory.current.busy = false;
            },
            redo: () => {
                if (snapshotsHistory.current.busy === true) {
                    return;
                }
                snapshotsHistory.current.busy = true;
                const nextSnapshot = snapshotsHistory.current.future.shift();
                if (!nextSnapshot) {
                    snapshotsHistory.current.present = null;
                    snapshotsHistory.current.busy = false;
                    return;
                } else if (snapshotsHistory.current.present) {
                    snapshotsHistory.current.past.push(snapshotsHistory.current.present);
                }
                snapshotsHistory.current.present = nextSnapshot;

                goToSnapshot(nextSnapshot);
                snapshotsHistory.current.busy = false;
            },
            startBatch: () => {
                snapshotsHistory.current.isBatching = true;
            },
            endBatch: () => {
                snapshotsHistory.current.isBatching = false;
            },
            disableHistory: () => {
                snapshotsHistory.current.isDisabled = true;
            },
            enableHistory: () => {
                snapshotsHistory.current.isDisabled = false;
            }
        }),
        []
    );

    const triggerEventAction = async <T extends EventActionHandlerCallableArgs>(
        ev: EventAction<T>,
        initialState: PbState,
        initiator: string[]
    ): Promise<EventActionHandlerActionCallableResponse> => {
        if (initiator.length >= config.current.maxEventActionsNesting) {
            throw new Error(
                `Max (${
                    config.current.maxEventActionsNesting
                }) allowed levels of nesting actions reached: ${initiator.join(" -> ")}`
            );
        }

        if (initiator.length === 0) {
            // Reset elements taking part in the event processing at the beginning of the cycle
            eventElements.current = {};
        }

        const name = ev.getName();
        if (!has(name)) {
            throw new Error(`There is no event action that is registered with name "${name}".`);
        }
        const targetCallables = get(name);
        const results: Required<EventActionHandlerActionCallableResponse> = {
            state: {},
            actions: []
        };
        if (!targetCallables) {
            return results;
        }
        const args = ev.getArgs();
        const callables = Array.from(targetCallables.values());
        for (const cb of callables) {
            const r =
                (await cb(
                    getCallableState({ ...initialState, ...results.state }),
                    {
                        client: apolloClient,
                        eventActionHandler: eventActionHandlerRef.current as EventActionHandler
                    },
                    args
                )) || {};
            results.state = {
                ...results.state,
                ...(r.state || {})
            };

            results.actions.push(...r.actions);
        }

        eventElements.current = { ...eventElements.current, ...results.state.elements };

        for (const action of results.actions) {
            const r = await triggerEventAction(
                action,
                getCallableState({ ...initialState, ...results.state }),
                initiator.concat([name])
            );
            results.state = {
                ...(results.state || {}),
                ...(r.state || {})
            };
        }
        return results;
    };

    return (
        <EventActionHandlerContext.Provider value={eventActionHandlerRef.current}>
            {children}
        </EventActionHandlerContext.Provider>
    );
};
