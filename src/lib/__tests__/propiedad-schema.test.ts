import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  CAMPOS_EDITAR_PROPIEDAD,
  crearPropiedadSchema,
  editarPropiedadSchema,
  propiedadIdSchema,
} from '@/lib/propiedad-schema'

const valid = {
  inquilinoActual: 'Juan Pérez',
  contactoInquilino: 'juan@example.com',
  direccion: 'Av. Colón 1234, Córdoba',
  montoInicial: '150000.5',
  fechaInicioContrato: '2026-03-01',
  fechaFinContrato: '2028-03-01',
  frecuenciaAumento: '4',
}

function parse(overrides: Record<string, unknown> = {}) {
  return crearPropiedadSchema.safeParse({ ...valid, ...overrides })
}

function errorsOf(overrides: Record<string, unknown> = {}) {
  const result = parse(overrides)
  if (result.success) throw new Error('expected validation to fail')
  return z.flattenError(result.error).fieldErrors as Record<string, string[]>
}

describe('crearPropiedadSchema', () => {
  it('accepts a complete valid input and normalizes it', () => {
    const result = parse()
    expect(result.success).toBe(true)
    expect(result.data).toEqual({
      inquilinoActual: 'Juan Pérez',
      contactoInquilino: 'juan@example.com',
      direccion: 'Av. Colón 1234, Córdoba',
      montoInicial: '150000.50',
      fechaInicioContrato: '2026-03-01',
      fechaFinContrato: '2028-03-01',
      frecuenciaAumento: 4,
    })
  })

  it('treats missing or blank tenant fields as null', () => {
    const result = parse({ inquilinoActual: '   ', contactoInquilino: undefined })
    expect(result.data?.inquilinoActual).toBeNull()
    expect(result.data?.contactoInquilino).toBeNull()
  })

  it('trims text fields', () => {
    const result = parse({ direccion: '  Calle 1  ', inquilinoActual: '  Ana ' })
    expect(result.data?.direccion).toBe('Calle 1')
    expect(result.data?.inquilinoActual).toBe('Ana')
  })

  describe('direccion', () => {
    it('is required', () => {
      expect(errorsOf({ direccion: '   ' }).direccion).toBeDefined()
      expect(errorsOf({ direccion: undefined }).direccion).toBeDefined()
    })

    it('has a maximum length', () => {
      expect(parse({ direccion: 'a'.repeat(200) }).success).toBe(true)
      expect(errorsOf({ direccion: 'a'.repeat(201) }).direccion).toBeDefined()
    })
  })

  describe('optional text fields', () => {
    it('have a maximum length', () => {
      expect(errorsOf({ inquilinoActual: 'a'.repeat(121) }).inquilinoActual).toBeDefined()
      expect(errorsOf({ contactoInquilino: 'a'.repeat(121) }).contactoInquilino).toBeDefined()
    })
  })

  describe('montoInicial', () => {
    it.each([
      ['100', '100.00'],
      ['100.5', '100.50'],
      ['100.55', '100.55'],
      ['0.01', '0.01'],
      ['007.5', '7.50'],
      ['  250  ', '250.00'],
      ['9999999999.99', '9999999999.99'],
    ])('accepts %s and normalizes it to %s', (input, expected) => {
      const result = parse({ montoInicial: input })
      expect(result.success).toBe(true)
      expect(result.data?.montoInicial).toBe(expected)
    })

    it.each([
      ['more than 2 decimals', '100.555'],
      ['zero', '0'],
      ['zero with decimals', '0.00'],
      ['negative', '-5'],
      ['comma decimal separator', '100,50'],
      ['letters', 'abc'],
      ['scientific notation', '1e5'],
      ['empty', ''],
      ['trailing dot', '100.'],
      ['too large for numeric(12,2)', '10000000000'],
      ['too large with decimals', '10000000000.00'],
    ])('rejects %s', (_label, input) => {
      expect(errorsOf({ montoInicial: input }).montoInicial).toBeDefined()
    })

    it('rejects a missing value', () => {
      expect(errorsOf({ montoInicial: undefined }).montoInicial).toBeDefined()
    })
  })

  describe('dates', () => {
    it('rejects a day that does not exist in the calendar (2026-02-30)', () => {
      expect(errorsOf({ fechaInicioContrato: '2026-02-30' }).fechaInicioContrato).toBeDefined()
      expect(errorsOf({ fechaFinContrato: '2026-02-30' }).fechaFinContrato).toBeDefined()
    })

    it('accepts a leap day only in leap years', () => {
      expect(parse({ fechaInicioContrato: '2028-02-29', fechaFinContrato: '2029-01-01' }).success).toBe(true)
      expect(errorsOf({ fechaInicioContrato: '2027-02-29' }).fechaInicioContrato).toBeDefined()
    })

    it.each(['2026-13-01', '2026-1-1', '01/03/2026', '2026-03-01T00:00:00Z', '', 'hoy'])(
      'rejects the malformed value %j',
      (input) => {
        expect(errorsOf({ fechaInicioContrato: input }).fechaInicioContrato).toBeDefined()
      }
    )

    it('requires both dates', () => {
      expect(errorsOf({ fechaInicioContrato: undefined }).fechaInicioContrato).toBeDefined()
      expect(errorsOf({ fechaFinContrato: undefined }).fechaFinContrato).toBeDefined()
    })

    it('rejects an end date before the start date, reporting it on fechaFinContrato', () => {
      const errors = errorsOf({ fechaInicioContrato: '2026-03-01', fechaFinContrato: '2026-02-28' })
      expect(errors.fechaFinContrato).toBeDefined()
      expect(errors.fechaInicioContrato).toBeUndefined()
    })

    it('rejects an end date equal to the start date', () => {
      expect(
        errorsOf({ fechaInicioContrato: '2026-03-01', fechaFinContrato: '2026-03-01' }).fechaFinContrato
      ).toBeDefined()
    })

    it('accepts an end date one day after the start date', () => {
      expect(parse({ fechaInicioContrato: '2026-03-01', fechaFinContrato: '2026-03-02' }).success).toBe(true)
    })
  })

  describe('frecuenciaAumento', () => {
    it.each([
      ['1', 1],
      ['4', 4],
      ['12', 12],
      [' 6 ', 6],
    ])('accepts %j', (input, expected) => {
      expect(parse({ frecuenciaAumento: input }).data?.frecuenciaAumento).toBe(expected)
    })

    it.each(['0', '-3', '1.5', '2e1', 'abc', '', '9999999999'])('rejects %j', (input) => {
      expect(errorsOf({ frecuenciaAumento: input }).frecuenciaAumento).toBeDefined()
    })

    it('rejects a missing value', () => {
      expect(errorsOf({ frecuenciaAumento: undefined }).frecuenciaAumento).toBeDefined()
    })
  })

  it('returns messages in Spanish', () => {
    const errors = errorsOf({ direccion: '', montoInicial: '0' })
    expect(errors.direccion[0]).toMatch(/obligatori/i)
    expect(errors.montoInicial[0]).toMatch(/mayor/i)
  })

  it('strips unknown keys such as propietarioId', () => {
    const result = parse({ propietarioId: '999' })
    expect(result.success).toBe(true)
    expect(result.data).not.toHaveProperty('propietarioId')
  })
})

describe('editarPropiedadSchema', () => {
  const validEdit = {
    inquilinoActual: 'Ana Gómez',
    contactoInquilino: 'ana@example.com',
    direccion: 'Calle 1',
    fechaFinContrato: '2029-03-01',
    frecuenciaAumento: '6',
  }

  function parseEdit(overrides: Record<string, unknown> = {}) {
    return editarPropiedadSchema.safeParse({ ...validEdit, ...overrides })
  }

  it('whitelists exactly the editable fields', () => {
    expect([...CAMPOS_EDITAR_PROPIEDAD].sort()).toEqual([
      'contactoInquilino',
      'direccion',
      'fechaFinContrato',
      'frecuenciaAumento',
      'inquilinoActual',
    ])
  })

  it('accepts a complete valid input without montoInicial or fechaInicioContrato', () => {
    const result = parseEdit()
    expect(result.success).toBe(true)
    expect(result.data).toEqual({
      inquilinoActual: 'Ana Gómez',
      contactoInquilino: 'ana@example.com',
      direccion: 'Calle 1',
      fechaFinContrato: '2029-03-01',
      frecuenciaAumento: 6,
    })
  })

  it('strips the immutable and server-owned fields instead of passing them through', () => {
    const result = parseEdit({
      montoInicial: '1',
      fechaInicioContrato: '2000-01-01',
      montoActual: '1',
      deudaAcumulada: '1',
      estado: 'inactiva',
      contratoPdfUrl: 'x',
      propietarioId: '9',
    })
    expect(result.success).toBe(true)
    expect(Object.keys(result.data!).sort()).toEqual([...CAMPOS_EDITAR_PROPIEDAD].sort())
  })

  it('does not enforce end > start: the start date is not part of the form', () => {
    // The persisted start date is checked by the logic layer, not by this schema
    expect(parseEdit({ fechaFinContrato: '1999-01-01' }).success).toBe(true)
  })

  it('reuses the field rules of the create schema', () => {
    const result = parseEdit({ direccion: '  ', fechaFinContrato: '2026-02-30', frecuenciaAumento: '0' })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(Object.keys(z.flattenError(result.error).fieldErrors).sort()).toEqual([
      'direccion',
      'fechaFinContrato',
      'frecuenciaAumento',
    ])
  })
})

describe('propiedadIdSchema', () => {
  it.each([
    ['1', 1],
    ['42', 42],
    [' 7 ', 7],
  ])('accepts %j', (input, expected) => {
    expect(propiedadIdSchema.parse(input)).toBe(expected)
  })

  it.each(['0', '-1', '1.5', '1e3', 'abc', '', '99999999999', null, undefined])(
    'rejects %j',
    (input) => {
      expect(propiedadIdSchema.safeParse(input).success).toBe(false)
    }
  )
})
