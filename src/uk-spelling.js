// Explicit verb families only. Never replace arbitrary -ize/-izing suffixes:
// size, prize, seize, capsize and their inflections must retain their z/s.
export const iseFamilies = `accessorize acclimatize actualize agonize alphabetize amortize anathematize antagonize authorize automatize baptize bastardize brutalize canonize capitalize caramelize carbonize categorize cauterize centralize characterize civilize colonize commercialize compartmentalize computerize conceptualize contextualize criminalize crystallize customize decentralize decolonize decriminalize dehumanize demobilize democratize demonize demoralize deodorize depersonalize destabilize digitize disorganize dramatize economize editorialize empathize emphasize energize equalize evangelize exorcize externalize familiarize fantasize fertilize finalize formalize fossilize fraternize galvanize generalize globalize glamourize harmonize homogenize hospitalize humanize hybridize hypothesize idealize idolize immobilize immunize industrialize initialize institutionalize internalize internationalize ionize italicize itemize jeopardize legalize legitimize liberalize lionize localize magnetize marginalize materialize maximize mechanize medicalize memorize metabolize militarize minimize mobilize modernize moisturize monopolize moralize nationalize naturalize neutralize normalize optimize organize ostracize patronize penalize personalize philosophize plagiarize polarize politicize popularize prioritize privatize publicize pulverize radicalize randomize rationalize realize reorganize revolutionize romanticize sanitize satirize scandalize scrutinize secularize sensitize serialize socialize specialize stabilize standardize sterilize stigmatize subsidize summarize symbolize sympathize synchronize synthesize tantalize terrorize theorize trivialize tyrannize unionize urbanize utilize vandalize vaporize verbalize victimize visualize vocalize weaponize westernize`.split(/\s+/).filter(word=>/^[a-z]+ize$/.test(word));
const nouns = new Set(`actualize amortize authorize automatize baptize brutalize canonize capitalize carbonize categorize cauterize centralize characterize civilize colonize commercialize compartmentalize computerize conceptualize contextualize criminalize crystallize customize decentralize decolonize decriminalize dehumanize demobilize democratize demonize demoralize deodorize depersonalize destabilize digitize disorganize dramatize equalize externalize familiarize fertilize finalize formalize fossilize galvanize generalize globalize harmonize homogenize hospitalize humanize hybridize idealize idolize immobilize immunize industrialize initialize institutionalize internalize internationalize ionize italicize legalize liberalize localize magnetize marginalize materialize maximize mechanize medicalize militarize minimize mobilize modernize monopolize nationalize naturalize neutralize normalize optimize organize penalize personalize polarize politicize popularize prioritize privatize pulverize radicalize randomize rationalize realize reorganize romanticize sanitize secularize sensitize serialize socialize specialize stabilize standardize sterilize stigmatize subsidize summarize symbolize synchronize synthesize unionize urbanize utilize vandalize vaporize verbalize victimize visualize vocalize weaponize westernize`.split(/\s+/));
const agents = new Set(`authorize baptize colonize customize deodorize fertilize generalize harmonize ionize localize materialize maximize minimize moisturize normalize optimize organize personalize polarize pulverize randomize reorganize sanitize serialize specialize stabilize sterilize summarize synchronize synthesize terrorize utilize vaporize visualize vocalize weaponize`.split(/\s+/));
export function familySpellings() {
  const result=[];
  for(const base of iseFamilies) {
    const root=base.slice(0,-1),uk=base.replace(/ize$/,'ise'),ukRoot=uk.slice(0,-1);
    for(const [from,to] of [[base,uk],[base+'s',uk+'s'],[base+'d',uk+'d'],[root+'ing',ukRoot+'ing']])result.push([from,to]);
    if(agents.has(base))for(const ending of ['r','rs'])result.push([base+ending,uk+ending]);
    if(nouns.has(base))for(const ending of ['ation','ations'])result.push([root+ending,ukRoot+ending]);
  }
  for(const base of ['analyze','paralyze','catalyze','hydrolyze','electrolyze','dialyze']) {
    const uk=base.replace(/yze$/,'yse');
    for(const ending of ['', 's','d'])result.push([base+ending,uk+ending]);
    result.push([base.slice(0,-1)+'ing',uk.slice(0,-1)+'ing']);
  }
  const other=`recognizable:recognisable recognizably:recognisably unrecognizable:unrecognisable unrecognizably:unrecognisably recognizability:recognisability
glamorize:glamourise glamorizes:glamourises glamorized:glamourised glamorizing:glamourising glamorization:glamourisation
enroll:enrol enrolls:enrols enrollment:enrolment enrollments:enrolments fulfill:fulfil fulfills:fulfils fulfillment:fulfilment
fueled:fuelled fueling:fuelling counselor:counsellor counselors:counsellors counseling:counselling counseled:counselled
aging:ageing acknowledgment:acknowledgement acknowledgments:acknowledgements judgment:judgement judgments:judgements
mold:mould molds:moulds molded:moulded molding:moulding mustache:moustache mustaches:moustaches
aluminum:aluminium cozy:cosy coziness:cosiness cozying:cosying plow:plough plows:ploughs plowed:ploughed plowing:ploughing
maneuver:manoeuvre maneuvers:manoeuvres maneuvered:manoeuvred maneuvering:manoeuvring
estrogen:oestrogen estrogenic:oestrogenic pediatric:paediatric pediatrician:paediatrician pediatricians:paediatricians
encyclopedia:encyclopaedia encyclopedias:encyclopaedias leukemia:leukaemia anemia:anaemia anesthetic:anaesthetic anesthetics:anaesthetics
omelet:omelette omelets:omelettes diarrhea:diarrhoea artifact:artefact artifacts:artefacts`.split(/\s+/).map(pair=>pair.split(':'));
  return [...result,...other];
}
