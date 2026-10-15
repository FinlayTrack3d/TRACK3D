// Alternatives for swapping an exercise (playbook Rules 36-40): same muscle
// and movement, the same equipment first. Used by the in-workout swap.
import { equipmentOf } from "./set-progression.js";

const GROUPS = [
  { test: /bench|chest press|push-?up|floor press|press-?up/, options: ["Dumbbell Bench Press", "Barbell Bench Press", "Machine Chest Press", "Incline Dumbbell Press", "Push-Up", "Dumbbell Floor Press"] },
  { test: /fly|flye|pec deck|crossover/, options: ["Dumbbell Fly", "Cable Fly", "Pec Deck", "Incline Dumbbell Fly"] },
  { test: /overhead press|shoulder press|military press|arnold/, options: ["Dumbbell Shoulder Press", "Barbell Overhead Press", "Machine Shoulder Press", "Arnold Press", "Seated Dumbbell Press"] },
  { test: /lateral raise|side raise/, options: ["Dumbbell Lateral Raise", "Cable Lateral Raise", "Machine Lateral Raise"] },
  { test: /row/, options: ["Dumbbell Row (single arm)", "Barbell Row", "Seated Cable Row", "Chest-Supported Dumbbell Row", "Machine Row", "T-Bar Row"] },
  { test: /pulldown|pull-?down|pull-?up|chin-?up/, options: ["Lat Pulldown", "Assisted Pull-Up", "Pull-Up", "Single-Arm Cable Pulldown", "Chin-Up"] },
  { test: /curl/, options: ["Dumbbell Bicep Curl", "Hammer Curl", "Cable Curl", "EZ-Bar Curl", "Incline Dumbbell Curl"] },
  { test: /tricep|pushdown|push-down|skull|dip|kickback/, options: ["Cable Tricep Pushdown", "Overhead Dumbbell Extension", "Dumbbell Skull Crusher", "Bench Dip", "Close-Grip Bench Press"] },
  { test: /squat|leg press|hack/, options: ["Goblet Squat", "Barbell Back Squat", "Leg Press", "Hack Squat", "Dumbbell Split Squat"] },
  { test: /lunge|split squat|step-?up/, options: ["Dumbbell Reverse Lunge", "Bulgarian Split Squat", "Dumbbell Step-Up", "Walking Lunge"] },
  { test: /deadlift|rdl|romanian|hinge|good morning|hip thrust|glute bridge/, options: ["Dumbbell Romanian Deadlift", "Barbell Romanian Deadlift", "Hip Thrust", "Cable Pull-Through", "Glute Bridge"] },
  { test: /leg curl|hamstring curl/, options: ["Seated Leg Curl", "Lying Leg Curl", "Swiss Ball Hamstring Curl"] },
  { test: /leg extension|quad extension/, options: ["Leg Extension", "Single-Leg Extension", "Spanish Squat"] },
  { test: /calf/, options: ["Standing Calf Raise", "Seated Calf Raise", "Dumbbell Calf Raise", "Leg Press Calf Raise"] },
  { test: /plank|crunch|ab |abs|core|sit-?up|leg raise|pallof/, options: ["Plank", "Cable Crunch", "Hanging Knee Raise", "Pallof Press", "Dead Bug"] },
];

// Up to `limit` alternatives for an exercise, the same equipment first,
// never the exercise itself.
export function swapAlternatives(name = "", limit = 5) {
  const text = String(name).toLowerCase();
  const group = GROUPS.find(item => item.test.test(text));
  if (!group) return [];
  const equipment = equipmentOf(name);
  const options = group.options.filter(option => option.toLowerCase() !== text);
  const same = options.filter(option => equipmentOf(option) === equipment);
  const other = options.filter(option => equipmentOf(option) !== equipment);
  return [...same, ...other].slice(0, limit);
}
