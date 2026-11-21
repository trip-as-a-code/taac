import { describe, expect, it } from 'vitest'
import * as kdbxweb from 'kdbxweb'

import {
  decryptKdbx,
  decodeShareKey,
  encodeShareKey,
  ensureArgon2,
  extractHashKey,
  VAULT_LINK_PREFIX,
} from './vault-crypto'

describe('share key & hash fragment helpers', () => {
  it('roundtrips UTF-8 passphrases through URL-safe base64', () => {
    const pass = 'p@ss/word+with=chars & юникод!'
    const encoded = encodeShareKey(pass)
    expect(encoded).not.toMatch(/[+/=]/)
    expect(decodeShareKey(encoded)).toBe(pass)
  })

  it('extracts #k= and preserves existing anchor fragments', () => {
    const encoded = encodeShareKey('secret-trip-key')
    expect(extractHashKey(`#k=${encoded}`)).toEqual({ key: 'secret-trip-key', cleanHash: '' })
    expect(extractHashKey(`#flight-1&k=${encoded}`)).toEqual({
      key: 'secret-trip-key',
      cleanHash: '#flight-1',
    })
    expect(extractHashKey('#flight-1')).toEqual({ key: null, cleanHash: '#flight-1' })
  })
})

describe('decryptKdbx', () => {
  it('decrypts KDBX4 Argon2id entries, fields, binary attachments, and vault links', async () => {
    ensureArgon2()

    const credentials = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString('master-pass'))
    const db = kdbxweb.Kdbx.create(credentials, 'test')
    db.header.kdfParameters!.set(
      '$UUID',
      kdbxweb.VarDictionary.ValueType.Bytes,
      kdbxweb.ByteUtils.arrayToBuffer(kdbxweb.ByteUtils.base64ToBytes(kdbxweb.Consts.KdfId.Argon2id)),
    )
    db.header.kdfParameters!.set('M', kdbxweb.VarDictionary.ValueType.UInt64, new kdbxweb.Int64(1024 * 1024))
    db.header.kdfParameters!.set('I', kdbxweb.VarDictionary.ValueType.UInt64, new kdbxweb.Int64(1))
    db.header.kdfParameters!.set('P', kdbxweb.VarDictionary.ValueType.UInt32, 1)

    const root = db.getDefaultGroup()
    const entry = db.createEntry(root)
    entry.fields.set('Title', 'TAP_LISBON')
    entry.fields.set('Password', kdbxweb.ProtectedValue.fromString('ABC123'))
    entry.fields.set('Phone', kdbxweb.ProtectedValue.fromString('+351 21 000 0000'))
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
    const bin = await db.createBinary(kdbxweb.ProtectedValue.fromBinary(pdf.slice().buffer))
    entry.binaries.set('boarding.pdf', bin)

    const linkEntry = db.createEntry(root)
    linkEntry.fields.set('Title', `${VAULT_LINK_PREFIX}lisbon`)
    linkEntry.fields.set('Password', kdbxweb.ProtectedValue.fromString('shared-trip-pw'))

    const saved = await db.save()
    const decrypted = await decryptKdbx(saved, 'master-pass')

    expect(decrypted.entries.TAP_LISBON?.value).toBe('ABC123')
    expect(decrypted.entries.TAP_LISBON?.fields.Phone).toBe('+351 21 000 0000')
    expect(Array.from(decrypted.entries.TAP_LISBON?.attachments['boarding.pdf'] ?? [])).toEqual(Array.from(pdf))
    expect(decrypted.linkedVaults.lisbon).toBe('shared-trip-pw')
  })
})
