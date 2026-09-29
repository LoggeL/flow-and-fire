;; xxHash32 (XXH32, Yann Collet) hand-written in WebAssembly text format (SPK5, PLAN §4).
;; Hashes bytes of the imported memory (the simulation arena) in place, without copying.
;; Build: pnpm --filter @faf/headless build:wasm  (wabt wat2wasm → xxh32.wasm, checked in).
(module
  (import "env" "memory" (memory 1))

  ;; xxh32(ptr, len, seed) -> u32 (as i32)
  (func $xxh32 (export "xxh32") (param $ptr i32) (param $len i32) (param $seed i32) (result i32)
    (local $p i32) (local $end i32) (local $limit i32) (local $h i32)
    (local $v1 i32) (local $v2 i32) (local $v3 i32) (local $v4 i32)
    (local.set $p (local.get $ptr))
    (local.set $end (i32.add (local.get $ptr) (local.get $len)))

    (if (i32.ge_u (local.get $len) (i32.const 16))
      (then
        (local.set $v1 (i32.add (i32.add (local.get $seed) (i32.const 0x9E3779B1)) (i32.const 0x85EBCA77)))
        (local.set $v2 (i32.add (local.get $seed) (i32.const 0x85EBCA77)))
        (local.set $v3 (local.get $seed))
        (local.set $v4 (i32.sub (local.get $seed) (i32.const 0x9E3779B1)))
        (local.set $limit (i32.sub (local.get $end) (i32.const 16)))
        (loop $stripes
          ;; v = rotl(v + lane * P2, 13) * P1, four lanes per 16-byte stripe
          (local.set $v1 (i32.mul (i32.rotl (i32.add (local.get $v1)
            (i32.mul (i32.load offset=0 align=1 (local.get $p)) (i32.const 0x85EBCA77))) (i32.const 13)) (i32.const 0x9E3779B1)))
          (local.set $v2 (i32.mul (i32.rotl (i32.add (local.get $v2)
            (i32.mul (i32.load offset=4 align=1 (local.get $p)) (i32.const 0x85EBCA77))) (i32.const 13)) (i32.const 0x9E3779B1)))
          (local.set $v3 (i32.mul (i32.rotl (i32.add (local.get $v3)
            (i32.mul (i32.load offset=8 align=1 (local.get $p)) (i32.const 0x85EBCA77))) (i32.const 13)) (i32.const 0x9E3779B1)))
          (local.set $v4 (i32.mul (i32.rotl (i32.add (local.get $v4)
            (i32.mul (i32.load offset=12 align=1 (local.get $p)) (i32.const 0x85EBCA77))) (i32.const 13)) (i32.const 0x9E3779B1)))
          (local.set $p (i32.add (local.get $p) (i32.const 16)))
          (br_if $stripes (i32.le_u (local.get $p) (local.get $limit))))
        (local.set $h (i32.add (i32.add (i32.add
          (i32.rotl (local.get $v1) (i32.const 1))
          (i32.rotl (local.get $v2) (i32.const 7)))
          (i32.rotl (local.get $v3) (i32.const 12)))
          (i32.rotl (local.get $v4) (i32.const 18)))))
      (else
        (local.set $h (i32.add (local.get $seed) (i32.const 0x165667B1)))))

    (local.set $h (i32.add (local.get $h) (local.get $len)))

    ;; remaining 4-byte words: h = rotl(h + w * P3, 17) * P4
    (block $words_done
      (loop $words
        (br_if $words_done (i32.gt_u (i32.add (local.get $p) (i32.const 4)) (local.get $end)))
        (local.set $h (i32.mul (i32.rotl (i32.add (local.get $h)
          (i32.mul (i32.load align=1 (local.get $p)) (i32.const 0xC2B2AE3D))) (i32.const 17)) (i32.const 0x27D4EB2F)))
        (local.set $p (i32.add (local.get $p) (i32.const 4)))
        (br $words)))

    ;; remaining bytes: h = rotl(h + b * P5, 11) * P1
    (block $bytes_done
      (loop $bytes
        (br_if $bytes_done (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $h (i32.mul (i32.rotl (i32.add (local.get $h)
          (i32.mul (i32.load8_u (local.get $p)) (i32.const 0x165667B1))) (i32.const 11)) (i32.const 0x9E3779B1)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $bytes)))

    ;; avalanche
    (local.set $h (i32.xor (local.get $h) (i32.shr_u (local.get $h) (i32.const 15))))
    (local.set $h (i32.mul (local.get $h) (i32.const 0x85EBCA77)))
    (local.set $h (i32.xor (local.get $h) (i32.shr_u (local.get $h) (i32.const 13))))
    (local.set $h (i32.mul (local.get $h) (i32.const 0xC2B2AE3D)))
    (i32.xor (local.get $h) (i32.shr_u (local.get $h) (i32.const 16))))
)
