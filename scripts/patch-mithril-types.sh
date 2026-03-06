#!/bin/sh
# Patch @types/mithril for Mithril JSX + TypeScript compatibility.
#
# Problem: @types/mithril defines JSX.Element as extending Vnode, but Mithril
# components (Component/FactoryComponent) are NOT Vnodes. This prevents using
# components in JSX expressions. Similarly, Child only accepts Vnode, preventing
# Component return values from being valid JSX children.
#
# Solution: Relax both types to accept any value. Mithril's m() hyperscript
# wraps components in Vnodes at runtime — these patches bridge the type gap.

FILE="node_modules/@types/mithril/index.d.ts"
[ -f "$FILE" ] || exit 0

sed -i 's/type Child = Vnode<any, any> | string | number | boolean | null | undefined;/type Child = any;/' "$FILE"
sed -i 's/interface Element extends Mithril.Vnode {}/interface Element {}/' "$FILE"
