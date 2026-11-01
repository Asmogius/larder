/* Larder Improved — Recipe Catalog
   75+ recipes with canonical ingredients.
*/
export const MEALS = [
  // Breakfasts
  {
    id: "b-yogurt",
    name: "Berry yogurt cup",
    slot: "breakfast",
    servings: 1,
    time: 5,
    keto: false,
    allergens: ["dairy"],
    ingredients: [
      { name: "Greek yogurt", qty: 1, unit: "cup" },
      { name: "mixed berries", qty: 0.5, unit: "cup" },
      { name: "honey", qty: 1, unit: "tsp" }
    ],
    steps: ["Add yogurt to a bowl", "Top with berries and honey"],
    centsPerServing: 180
  },
  {
    id: "b-chia",
    name: "Chia pudding",
    slot: "breakfast",
    servings: 1,
    time: 10,
    keto: true,
    allergens: [],
    ingredients: [
      { name: "chia seeds", qty: 3, unit: "tbsp" },
      { name: "almond milk", qty: 1, unit: "cup" },
      { name: "vanilla", qty: 0.5, unit: "tsp" }
    ],
    steps: ["Mix chia and milk", "Refrigerate 10 min"],
    centsPerServing: 120
  }
  // more recipes in full version
];
