/* Central role grants. Seller access additionally requires an approved owned store. */
const PERMISSIONS = {
  customer: ['orders:own'],
  management: ['catalog:write','orders:read','orders:write','customers:read','customers:write','reports:read','audit:business','settings:store','sandbox:use'],
  maintenance: ['maintenance:operate','health:read','events:read','audit:technical','settings:email','settings:maintenance','sandbox:use']
};
const sectionsFor = role => role === 'management' ? ['store'] : role === 'maintenance' ? ['email','maintenance'] : [];
Object.values(PERMISSIONS).forEach(Object.freeze);Object.freeze(PERMISSIONS);
const hasPermission=(role,permission)=>Object.hasOwn(PERMISSIONS,role)&&PERMISSIONS[role].includes(permission);
module.exports={PERMISSIONS,sectionsFor,hasPermission};
