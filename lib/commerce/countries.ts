/**
 * The countries a customer can pick at checkout — kept identical to COUNTRIES in
 * public/commerce.js (plain browser script, so it can't import this; update both together).
 * Anything that's scoped to "the customer's delivery country" (checkout questions today) is
 * validated against this list, so an owner can never pick a country no customer is able to
 * choose — which would silently mean "never shown".
 */
export const CHECKOUT_COUNTRIES: [code: string, name: string][] = [
  ["NG", "Nigeria"], ["GH", "Ghana"], ["KE", "Kenya"], ["ZA", "South Africa"], ["EG", "Egypt"],
  ["MA", "Morocco"], ["ET", "Ethiopia"], ["TZ", "Tanzania"], ["UG", "Uganda"], ["CI", "Côte d'Ivoire"],
  ["SN", "Senegal"], ["CM", "Cameroon"], ["ZW", "Zimbabwe"], ["ZM", "Zambia"], ["RW", "Rwanda"],
  ["BJ", "Benin"], ["TG", "Togo"], ["SL", "Sierra Leone"], ["LR", "Liberia"], ["NE", "Niger"],
  ["ML", "Mali"], ["BF", "Burkina Faso"], ["GM", "Gambia"], ["GW", "Guinea-Bissau"], ["GN", "Guinea"],
  ["MR", "Mauritania"], ["TD", "Chad"], ["CD", "DR Congo"], ["CG", "Congo"], ["GA", "Gabon"],
  ["GQ", "Equatorial Guinea"], ["AO", "Angola"], ["NA", "Namibia"], ["BW", "Botswana"], ["MZ", "Mozambique"],
  ["MW", "Malawi"], ["MG", "Madagascar"], ["SS", "South Sudan"], ["SD", "Sudan"], ["SO", "Somalia"],
  ["DJ", "Djibouti"], ["ER", "Eritrea"], ["LY", "Libya"], ["TN", "Tunisia"], ["DZ", "Algeria"],
  ["CV", "Cabo Verde"], ["ST", "São Tomé and Príncipe"], ["SC", "Seychelles"], ["MU", "Mauritius"],
  ["KM", "Comoros"], ["SZ", "Eswatini"], ["LS", "Lesotho"], ["BI", "Burundi"], ["US", "United States"],
  ["GB", "United Kingdom"], ["CA", "Canada"], ["AU", "Australia"], ["NZ", "New Zealand"], ["IE", "Ireland"],
  ["DE", "Germany"], ["FR", "France"], ["ES", "Spain"], ["PT", "Portugal"], ["IT", "Italy"],
  ["NL", "Netherlands"], ["BE", "Belgium"], ["CH", "Switzerland"], ["AT", "Austria"], ["SE", "Sweden"],
  ["NO", "Norway"], ["DK", "Denmark"], ["FI", "Finland"], ["PL", "Poland"], ["GR", "Greece"],
  ["TR", "Türkiye"], ["RU", "Russia"], ["UA", "Ukraine"], ["AE", "United Arab Emirates"],
  ["SA", "Saudi Arabia"], ["QA", "Qatar"], ["KW", "Kuwait"], ["BH", "Bahrain"], ["OM", "Oman"],
  ["JO", "Jordan"], ["LB", "Lebanon"], ["IL", "Israel"], ["IN", "India"], ["PK", "Pakistan"],
  ["BD", "Bangladesh"], ["CN", "China"], ["JP", "Japan"], ["KR", "South Korea"], ["SG", "Singapore"],
  ["MY", "Malaysia"], ["ID", "Indonesia"], ["PH", "Philippines"], ["TH", "Thailand"], ["VN", "Vietnam"],
  ["BR", "Brazil"], ["MX", "Mexico"], ["AR", "Argentina"], ["CO", "Colombia"], ["CL", "Chile"],
  ["PE", "Peru"], ["JM", "Jamaica"], ["TT", "Trinidad and Tobago"],
];

const NAME_BY_CODE = new Map(CHECKOUT_COUNTRIES);

export function checkoutCountryName(code: string): string | null {
  return NAME_BY_CODE.get(code) ?? null;
}
