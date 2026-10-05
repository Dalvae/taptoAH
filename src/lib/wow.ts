/** WoW 3.3.5a (WotLK) static data: item qualities, ItemClass / ItemSubClass names, time-left buckets. */

export const QUALITIES: { id: number; name: string; color: string }[] = [
	{ id: 0, name: 'Poor', color: '#9d9d9d' },
	{ id: 1, name: 'Common', color: '#ffffff' },
	{ id: 2, name: 'Uncommon', color: '#1eff00' },
	{ id: 3, name: 'Rare', color: '#0070dd' },
	{ id: 4, name: 'Epic', color: '#a335ee' },
	{ id: 5, name: 'Legendary', color: '#ff8000' },
	{ id: 6, name: 'Artifact', color: '#e6cc80' },
	{ id: 7, name: 'Heirloom', color: '#e6cc80' }
];

export function qualityColor(q: number | null | undefined): string {
	return (q != null && QUALITIES[q]?.color) || '#c8c8c8';
}

/** ItemClass.dbc / ItemSubClass.dbc as of 3.3.5a (build 12340). */
export const CLASSES: Record<number, { name: string; sub: Record<number, string> }> = {
	0: {
		name: 'Consumable',
		sub: {
			0: 'Consumable',
			1: 'Potion',
			2: 'Elixir',
			3: 'Flask',
			4: 'Scroll',
			5: 'Food & Drink',
			6: 'Item Enhancement',
			7: 'Bandage',
			8: 'Other'
		}
	},
	1: {
		name: 'Container',
		sub: {
			0: 'Bag',
			1: 'Soul Bag',
			2: 'Herb Bag',
			3: 'Enchanting Bag',
			4: 'Engineering Bag',
			5: 'Gem Bag',
			6: 'Mining Bag',
			7: 'Leatherworking Bag',
			8: 'Inscription Bag'
		}
	},
	2: {
		name: 'Weapon',
		sub: {
			0: 'One-Handed Axes',
			1: 'Two-Handed Axes',
			2: 'Bows',
			3: 'Guns',
			4: 'One-Handed Maces',
			5: 'Two-Handed Maces',
			6: 'Polearms',
			7: 'One-Handed Swords',
			8: 'Two-Handed Swords',
			9: 'Obsolete',
			10: 'Staves',
			11: 'One-Handed Exotics',
			12: 'Two-Handed Exotics',
			13: 'Fist Weapons',
			14: 'Miscellaneous',
			15: 'Daggers',
			16: 'Thrown',
			17: 'Spears',
			18: 'Crossbows',
			19: 'Wands',
			20: 'Fishing Poles'
		}
	},
	3: {
		name: 'Gem',
		sub: {
			0: 'Red',
			1: 'Blue',
			2: 'Yellow',
			3: 'Purple',
			4: 'Green',
			5: 'Orange',
			6: 'Meta',
			7: 'Simple',
			8: 'Prismatic'
		}
	},
	4: {
		name: 'Armor',
		sub: {
			0: 'Miscellaneous',
			1: 'Cloth',
			2: 'Leather',
			3: 'Mail',
			4: 'Plate',
			5: 'Bucklers',
			6: 'Shields',
			7: 'Librams',
			8: 'Idols',
			9: 'Totems',
			10: 'Sigils'
		}
	},
	5: { name: 'Reagent', sub: { 0: 'Reagent' } },
	6: {
		name: 'Projectile',
		sub: { 0: 'Wand', 1: 'Bolt', 2: 'Arrow', 3: 'Bullet', 4: 'Thrown' }
	},
	7: {
		name: 'Trade Goods',
		sub: {
			0: 'Trade Goods',
			1: 'Parts',
			2: 'Explosives',
			3: 'Devices',
			4: 'Jewelcrafting',
			5: 'Cloth',
			6: 'Leather',
			7: 'Metal & Stone',
			8: 'Meat',
			9: 'Herb',
			10: 'Elemental',
			11: 'Other',
			12: 'Enchanting',
			13: 'Materials',
			14: 'Armor Enchantment',
			15: 'Weapon Enchantment'
		}
	},
	8: { name: 'Generic', sub: { 0: 'Generic' } },
	9: {
		name: 'Recipe',
		sub: {
			0: 'Book',
			1: 'Leatherworking',
			2: 'Tailoring',
			3: 'Engineering',
			4: 'Blacksmithing',
			5: 'Cooking',
			6: 'Alchemy',
			7: 'First Aid',
			8: 'Enchanting',
			9: 'Fishing',
			10: 'Jewelcrafting',
			11: 'Inscription'
		}
	},
	10: { name: 'Money', sub: { 0: 'Money' } },
	11: {
		name: 'Quiver',
		sub: { 0: 'Quiver (obsolete)', 1: 'Quiver (obsolete)', 2: 'Quiver', 3: 'Ammo Pouch' }
	},
	12: { name: 'Quest', sub: { 0: 'Quest' } },
	13: { name: 'Key', sub: { 0: 'Key', 1: 'Lockpick' } },
	14: { name: 'Permanent', sub: { 0: 'Permanent' } },
	15: {
		name: 'Miscellaneous',
		sub: { 0: 'Junk', 1: 'Reagent', 2: 'Pet', 3: 'Holiday', 4: 'Other', 5: 'Mount' }
	},
	16: {
		name: 'Glyph',
		sub: {
			1: 'Warrior',
			2: 'Paladin',
			3: 'Hunter',
			4: 'Rogue',
			5: 'Priest',
			6: 'Death Knight',
			7: 'Shaman',
			8: 'Mage',
			9: 'Warlock',
			11: 'Druid'
		}
	}
};

export function className(c: number | null | undefined): string {
	if (c == null) return 'Unknown';
	return CLASSES[c]?.name ?? `Class ${c}`;
}

export function subclassName(c: number | null | undefined, s: number | null | undefined): string {
	if (c == null || s == null) return '';
	return CLASSES[c]?.sub[s] ?? `Subclass ${s}`;
}

export const TIME_LEFT: Record<number, { label: string; hint: string }> = {
	1: { label: 'Short', hint: '< 30 min' },
	2: { label: 'Medium', hint: '30 min – 2 h' },
	3: { label: 'Long', hint: '2 h – 12 h' },
	4: { label: 'Very Long', hint: '> 12 h' }
};

export const INVENTORY_TYPES: Record<number, string> = {
	1: 'Head',
	2: 'Neck',
	3: 'Shoulder',
	4: 'Shirt',
	5: 'Chest',
	6: 'Waist',
	7: 'Legs',
	8: 'Feet',
	9: 'Wrist',
	10: 'Hands',
	11: 'Finger',
	12: 'Trinket',
	13: 'One-Hand',
	14: 'Shield',
	15: 'Ranged',
	16: 'Back',
	17: 'Two-Hand',
	18: 'Bag',
	19: 'Tabard',
	20: 'Chest',
	21: 'Main Hand',
	22: 'Off Hand',
	23: 'Held In Off-hand',
	24: 'Ammo',
	25: 'Thrown',
	26: 'Ranged',
	27: 'Quiver',
	28: 'Relic'
};

export function wowheadUrl(id: number): string {
	return `https://www.wowhead.com/wotlk/item=${id}`;
}

/** data-wowhead value for Wowhead's WotLK tooltip; undefined for server-custom items Wowhead lacks. */
export function wowheadTooltip(itemId: number | null | undefined): string | undefined {
	return itemId != null && itemId > 0 && itemId < 100000 ? `item=${itemId}&domain=wotlk` : undefined;
}
