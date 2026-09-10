/**
 * GrowthForge Controlled Sample Project Catalog (Phase 5E)
 *
 * Provides a structured, deterministic repository of realistic real estate projects
 * across primary and secondary test markets (Vrindavan, Mathura, Gurgaon, Delhi NCR, Bengaluru, Mumbai).
 */

import { DbProject } from '../../schemas/database';

export const SAMPLE_PROJECT_CATALOG: Array<Omit<DbProject, 'id' | 'created_at' | 'updated_at'>> = [
  // --- VRINDAVAN RESIDENTIAL & FARM HOUSES (Primary Test Market) ---
  {
    project_code: 'VRN-CKR-01',
    project_name: 'Braj Heritage Residences',
    developer_name: 'Brajbhumi Developers',
    city: 'Vrindavan',
    locality: 'Chatti Kila Road',
    micro_market: 'Chatti Kila Road',
    property_type: 'Residential Apartment',
    configurations: ['3 BHK', '4 BHK'],
    price_min: 6500000, // 65 Lakh
    price_max: 12000000, // 1.2 Cr
    possession: 'Ready to Move',
    project_description: 'Serene gated residential community near ISKCON and Prem Mandir along Chatti Kila Road.',
    features: ['Temple Corridor Access', '24x7 Security & Power Backup', 'Vastu Compliant', 'Landscape Gardens'],
    amenities: ['Meditation Hall', 'Satsang Bhawan', 'Yoga Pavilion', 'Senior Citizen Park', 'Vegetarian Cafeteria'],
    project_url: 'https://example.com/projects/braj-heritage',
    status: 'ACTIVE',
  },
  {
    project_code: 'VRN-CKR-02',
    project_name: 'Radha Madhav Farms & Enclave',
    developer_name: 'Vrindavan Land Holdings',
    city: 'Vrindavan',
    locality: 'Chatti Kila Road',
    micro_market: 'Chatti Kila Road Area',
    property_type: 'Farm House',
    configurations: ['800-1000 sq yd', '1200 sq yd', 'Farm Villa'],
    price_min: 11000000, // 1.1 Cr
    price_max: 25000000, // 2.5 Cr
    possession: 'Ready to Move',
    project_description: 'Lush green organic farm houses and bespoke farm villa plots situated right off Chatti Kila Road.',
    features: ['Gated Farm Enclave', '800-1000 sq yd Plots', 'Solar Street Lighting', 'Organic Plantation Boundary'],
    amenities: ['Private Goshala Access', 'Ayurvedic Wellness Center', 'Clubhouse', 'Walking Trails'],
    project_url: 'https://example.com/projects/radha-madhav-farms',
    status: 'ACTIVE',
  },
  {
    project_code: 'VRN-VIP-03',
    project_name: 'Shri Krishna Valley VIP Enclave',
    developer_name: 'Mathura-Vrindavan Housing Corp',
    city: 'Vrindavan',
    locality: 'VIP Road',
    micro_market: 'VIP Road Corridor',
    property_type: 'Residential Apartment',
    configurations: ['2 BHK', '3 BHK', '3 BHK + Pooja Room'],
    price_min: 5500000, // 55 Lakh
    price_max: 9500000, // 95 Lakh
    possession: 'Q2 2026',
    project_description: 'Modern luxury apartments on VIP Road with immediate arterial connectivity to NH-19.',
    features: ['NH-19 Expressway Connectivity', 'Modular Kitchens', 'Covered Parking', 'EV Charging Points'],
    amenities: ['Community Hall', 'Gymnasium', 'Children Play Area', 'Rooftop Terrace Garden'],
    project_url: 'https://example.com/projects/shri-krishna-valley',
    status: 'ACTIVE',
  },
  {
    project_code: 'VRN-RMN-04',
    project_name: 'Vrindavan Sanctum Villas',
    developer_name: 'Govardhan Estates',
    city: 'Vrindavan',
    locality: 'Raman Reti',
    micro_market: 'Raman Reti',
    property_type: 'Luxury Villa',
    configurations: ['3 BHK Villa', '4 BHK Villa'],
    price_min: 13500000, // 1.35 Cr
    price_max: 22000000, // 2.2 Cr
    possession: 'Ready to Move',
    project_description: 'Independent designer spiritual villas in the prestigious Raman Reti spiritual zone.',
    features: ['Private Courtyard', 'Double-height Ceilings', 'Italian Marble Flooring', 'Gated Security'],
    amenities: ['Private Temple', 'Library', 'Heated Plunge Pool', 'Concierge Desk'],
    project_url: 'https://example.com/projects/sanctum-villas',
    status: 'ACTIVE',
  },
  {
    project_code: 'VRN-SNK-05',
    project_name: 'Sunrakh Riverfront Farmsteads',
    developer_name: 'Yamuna Green Vistas',
    city: 'Vrindavan',
    locality: 'Sunrakh Road',
    micro_market: 'Sunrakh / Chatti Kila Belt',
    property_type: 'Farm House',
    configurations: ['800-1000 sq yd', '1500 sq yd'],
    price_min: 9000000, // 90 Lakh
    price_max: 18000000, // 1.8 Cr
    possession: 'Ready to Move',
    project_description: 'Expansive farm plots with fertile green soil and water frontage near Sunrakh village.',
    features: ['Clear Title Freehold', 'Tree-lined Internal Roads', 'Perimeter Drip Irrigation', 'Borewell Supply'],
    amenities: ['Clubhouse', 'Organic Produce Marketplace', 'Children Farm Park'],
    project_url: 'https://example.com/projects/sunrakh-riverfront',
    status: 'ACTIVE',
  },
  {
    project_code: 'VRN-PLT-06',
    project_name: 'Kanha Greens Residential Plots',
    developer_name: 'Braj Realtech',
    city: 'Vrindavan',
    locality: 'Rukmani Vihar',
    micro_market: 'Rukmani Vihar / NH-19',
    property_type: 'Residential Plot',
    configurations: ['150 sq yd', '250 sq yd', '500 sq yd'],
    price_min: 3500000, // 35 Lakh
    price_max: 8500000, // 85 Lakh
    possession: 'Immediate Registry',
    project_description: 'MVDA approved residential freehold plots with paved wide avenues and underground cabling.',
    features: ['MVDA Approved', 'Immediate Registry & Mutation', 'Underground Utilities', 'Street Lighting'],
    amenities: ['Parks & Open Green Areas', 'Commercial Retail Zone'],
    project_url: 'https://example.com/projects/kanha-greens',
    status: 'ACTIVE',
  },
  {
    project_code: 'VRN-2BHK-07',
    project_name: 'Anand Dham Studio & 2BHK Enclave',
    developer_name: 'Anand Promoters',
    city: 'Vrindavan',
    locality: 'Chatti Kila Road',
    micro_market: 'Chatti Kila Road',
    property_type: 'Residential Apartment',
    configurations: ['1 BHK', '2 BHK'], // ONLY 1 BHK & 2 BHK (for testing config mismatch when buyer asks 3 BHK)
    price_min: 3200000, // 32 Lakh
    price_max: 4800000, // 48 Lakh
    possession: 'Ready to Move',
    project_description: 'Compact pilgrimage suites and 2 BHK residences for weekend spiritual retreats.',
    features: ['Compact Living', 'Rental Management Available', 'Elevator', 'Power Backup'],
    amenities: ['Dining Hall', 'Community Lounge'],
    project_url: 'https://example.com/projects/anand-dham',
    status: 'ACTIVE',
  },

  // --- MATHURA (Adjacent Market) ---
  {
    project_code: 'MTH-DEL-08',
    project_name: 'Mathura Heritage Towers',
    developer_name: 'Ganga Yamuna Builders',
    city: 'Mathura',
    locality: 'Delhi-Mathura Highway',
    micro_market: 'NH-19 Mathura Bypass',
    property_type: 'Residential Apartment',
    configurations: ['2 BHK', '3 BHK', '4 BHK'],
    price_min: 4500000, // 45 Lakh
    price_max: 8500000, // 85 Lakh
    possession: 'Ready to Move',
    project_description: 'Township living with complete urban conveniences along the Delhi-Mathura express corridor.',
    features: ['Highway Access', 'Modern Clubhouse', 'Commercial Market'],
    amenities: ['Swimming Pool', 'Gym', 'Badminton Court'],
    project_url: 'https://example.com/projects/mathura-heritage',
    status: 'ACTIVE',
  },
  {
    project_code: 'MTH-COM-09',
    project_name: 'Mathura Cyber & Business Hub',
    developer_name: 'Apex Commercials',
    city: 'Mathura',
    locality: 'Krishna Nagar',
    micro_market: 'Krishna Nagar Commercial Core',
    property_type: 'Commercial Office',
    configurations: ['Office Suite', 'Retail Shop', 'Showroom'],
    price_min: 5000000, // 50 Lakh
    price_max: 20000000, // 2.0 Cr
    possession: 'Ready to Move',
    project_description: 'Grade-A commercial office space and retail mall in central Mathura.',
    features: ['Central Air Conditioning', 'High Speed Elevators', 'Basement Parking'],
    amenities: ['Food Court', 'Conference Rooms', 'ATM'],
    project_url: 'https://example.com/projects/mathura-business-hub',
    status: 'ACTIVE',
  },

  // --- GURGAON & DELHI NCR ---
  {
    project_code: 'GUR-DLF-01',
    project_name: 'The Arbour by DLF',
    developer_name: 'DLF Limited',
    city: 'Gurgaon',
    locality: 'Sector 63',
    micro_market: 'Golf Course Extension Road',
    property_type: 'Luxury Residential Apartment',
    configurations: ['4 BHK', '4 BHK + Servant'],
    price_min: 75000000, // 7.5 Cr
    price_max: 95000000, // 9.5 Cr
    possession: 'Q4 2028',
    project_description: 'Ultra-luxury low-density high-rise condominium in prime Sector 63.',
    features: ['Low Density (2 per core)', 'VRV Air-Conditioning', 'Aravalli Views', 'Large Decks'],
    amenities: ['100,000 sq ft Clubhouse', 'Olympic-size Heated Pool', 'Private Theater', 'Spa Sanctuary'],
    project_url: 'https://example.com/projects/dlf-arbour',
    status: 'ACTIVE',
  },
  {
    project_code: 'GUR-EMA-02',
    project_name: 'Emaar Urban Oasis',
    developer_name: 'Emaar India',
    city: 'Gurgaon',
    locality: 'Sector 62',
    micro_market: 'Golf Course Extension Road',
    property_type: 'Residential Apartment',
    configurations: ['3 BHK', '3 BHK + Utility', '4 BHK'],
    price_min: 42000000, // 4.2 Cr
    price_max: 65000000, // 6.5 Cr
    possession: 'Q3 2027',
    project_description: 'Modern residential high-rise with premium amenities on Golf Course Ext Road.',
    features: ['Voice Automation Ready', 'Italian Marble', 'Panoramic Views'],
    amenities: ['Sky Lounge', 'Concierge Desk', 'Gymnasium', 'Billiards Room'],
    project_url: 'https://example.com/projects/emaar-urban-oasis',
    status: 'ACTIVE',
  },
  {
    project_code: 'GUR-SOB-03',
    project_name: 'Sobha City Dwarka Expressway',
    developer_name: 'Sobha Limited',
    city: 'Gurgaon',
    locality: 'Sector 108',
    micro_market: 'Dwarka Expressway',
    property_type: 'Residential Apartment',
    configurations: ['2 BHK', '3 BHK', '3 BHK + Study'],
    price_min: 21000000, // 2.1 Cr
    price_max: 34000000, // 3.4 Cr
    possession: 'Ready to Move',
    project_description: 'Urban luxury development spread across 39 acres near Delhi border.',
    features: ['German Precast Technology', '8.5 Acre Urban Park', 'Near IGI Airport'],
    amenities: ['2 Oval Clubhouses', 'Half-acre Resort Pool', 'Cricket Ground', 'Tennis Courts'],
    project_url: 'https://example.com/projects/sobha-city',
    status: 'ACTIVE',
  },
  {
    project_code: 'GUR-TAT-04',
    project_name: 'Tata Primanti Executive Floors',
    developer_name: 'Tata Housing',
    city: 'Gurgaon',
    locality: 'Sector 72',
    micro_market: 'Southern Peripheral Road',
    property_type: 'Luxury Villa / Floors',
    configurations: ['4 BHK Floors', 'Duplex Penthouse'],
    price_min: 48000000, // 4.8 Cr
    price_max: 72000000, // 7.2 Cr
    possession: 'Ready to Move',
    project_description: 'European-inspired low-rise living surrounded by manicured orchards and private terraces.',
    features: ['Private Elevator', 'Rooftop Deck', 'Underground Parking', 'Low Density'],
    amenities: ['25,000 sq ft Club Primanti', 'Indoor Heated Pool', 'Amphitheater', 'Restaurant'],
    project_url: 'https://example.com/projects/tata-primanti',
    status: 'ACTIVE',
  },
  {
    project_code: 'DEL-VAS-05',
    project_name: 'Vasant Enclave Luxury Penthouses',
    developer_name: 'Capital Realty',
    city: 'Delhi',
    locality: 'Vasant Vihar',
    micro_market: 'South Delhi Core',
    property_type: 'Residential Apartment',
    configurations: ['4 BHK', '5 BHK Penthouse'],
    price_min: 150000000, // 15 Cr
    price_max: 280000000, // 28 Cr
    possession: 'Ready to Move',
    project_description: 'Ultra-exclusive residential floor plates in South Delhi diplomatic enclave.',
    features: ['Diplomatic Zone', 'Multi-tier Bulletproof Glass', 'Private Elevators'],
    amenities: ['Private Health Club', 'Concierge Butler'],
    project_url: 'https://example.com/projects/vasant-enclave',
    status: 'ACTIVE',
  },

  // --- INCOMPLETE / SPECIAL DATA TEST PROJECTS ---
  {
    project_code: 'TEST-INC-99',
    project_name: 'Unverified Project Data Sample',
    developer_name: null,
    city: 'Vrindavan',
    locality: 'Unknown Area',
    micro_market: null,
    property_type: null,
    configurations: null,
    price_min: null, // No verified budget
    price_max: null,
    possession: null,
    project_description: null,
    features: null,
    amenities: null,
    project_url: null,
    status: 'ACTIVE',
  },
];
