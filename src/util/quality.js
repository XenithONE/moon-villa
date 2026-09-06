let tier;
export function qualityTier() {
  if (tier) return tier;
  const q = new URLSearchParams(location.search).get('q');
  if (q === 'low' || q === 'high') return (tier = q);
  let r = '';
  try { const gl = document.createElement('canvas').getContext('webgl2'); const d = gl?.getExtension('WEBGL_debug_renderer_info'); r = d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : ''; } catch {}
  const weak = /Intel|Iris|UHD|HD Graphics|Apple GPU|Mali|Adreno|PowerVR|SwiftShader|llvmpipe/i.test(r)
    || (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4 || /Mobi|Android/i.test(navigator.userAgent);
  return (tier = weak ? 'low' : 'high');
}
