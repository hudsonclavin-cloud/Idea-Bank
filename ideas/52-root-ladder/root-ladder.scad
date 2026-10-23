// Root Ladder / all dimensions mm / print tabs upward, then flip onto jar
$fn=48;
difference(){
 union(){
  cube([84,26,3]);
  translate([11.145502758916976,10,3]) cube([3,6,4]);
  translate([69.85449724108302,10,3]) cube([3,6,4]);
 }
 translate([16,5,-1]) cube([14.666666666666664,16,5]);
 translate([34.666666666666664,5,-1]) cube([14.666666666666664,16,5]);
 translate([53.33333333333333,5,-1]) cube([14.666666666666671,16,5]);
}
