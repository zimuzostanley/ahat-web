import m from "mithril";

/** Fragment component for Mithril. Returns children as-is. */
export function Fragment(): m.Component<{}> {
  return {
    view(vnode) { return vnode.children as m.Children; },
  };
}
