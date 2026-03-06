import m from "mithril";

/** JSX Fragment component for Mithril. Used as jsxFragmentFactory in tsconfig/esbuild. */
export function Fragment(): m.Component<{}> {
  return {
    view(vnode) { return vnode.children as m.Children; },
  };
}
