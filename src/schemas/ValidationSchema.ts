export const AddressSchema = {
  id: '/Address',
  type: 'string',
  pattern: '^0x[0-9a-fA-F]{40}$'
};

export const ECSignatureParameterSchema = {
  id: '/ECSignatureParameter',
  type: 'string',
  pattern: '^0[xX][0-9A-Fa-f]{64}$'
};

export const ECSignatureSchema = {
  id: '/ECSignature',
  properties: {
    v: {
      type: 'number',
      minimum: 27,
      maximum: 28
    },
    r: { $ref: '/ECSignatureParameter' },
    s: { $ref: '/ECSignatureParameter' }
  },
  required: ['v', 'r', 's'],
  type: 'object'
};

export const NumberSchema = {
  id: '/Number',
  type: 'string',
  pattern: '([-+]?\\d*\\.?\\d+)(?:[eE]([-+]?\\d+))?$'
};
