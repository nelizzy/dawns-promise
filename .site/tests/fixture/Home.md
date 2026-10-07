# Fixture home

[[Books/Dune|Dune]] and [[Datacore Demo]] and [[Books.base]].

## Table embed
![[Books.base#Table]]

## Cards embed
![[Books.base#Cards]]

## Whole base (view switcher)
![[Books.base]]

## Inline base block (uses `this`)
```base
filters:
  and:
    - this.file.hasLink(file)
views:
  - type: list
    name: Linked from here
    order:
      - file.name
```

## Missing base
![[Nope.base]]
