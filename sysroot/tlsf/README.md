TLSF 3.1 from https://github.com/mattconte/tlsf at commit
`deff9ab509341f264addbd3c8ada533678591905`.

Wasm adaptation: compile as C++23, use wasm.hpp for memcpy, trap assertions,
and suppress diagnostic printf calls. The allocator algorithm is unchanged.
BSD license is in tlsf.hpp.
