// Confirmed department names, expanded only for telephone-directory questions.
const {termAlternatives}=require("../synonyms");
const CONTACT_ALIAS_GROUPS=Object.freeze([{terms:Object.freeze(["비뇨의학과","비뇨의학","비뇨기과","비뇨의학센터","비뇨기","비뇨"])}]);
const configured=termAlternatives(CONTACT_ALIAS_GROUPS.flatMap(group=>group.terms),CONTACT_ALIAS_GROUPS);
function departmentAlternatives(term){return configured.get(term)||[term];}
function splitContactAliasQuery(query){return String(query||"").replace(/(비뇨의학센터|비뇨의학과|비뇨기과|비뇨의학|비뇨기|비뇨)\s*(전화번호|내선번호|연락처|번호)/gu,"$1 $2");}
module.exports={CONTACT_ALIAS_GROUPS,departmentAlternatives,splitContactAliasQuery};
