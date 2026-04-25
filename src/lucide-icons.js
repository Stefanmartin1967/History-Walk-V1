/**
 * lucide-icons.js
 * Source unique pour les icônes Lucide — cherry-pick des icônes réellement utilisées.
 * Permet le tree-shaking et réduit le bundle (~200-400KB).
 *
 * Pour ajouter une icône : importer ici et l'ajouter à appIcons.
 */

import {
    createIcons,

    // Navigation & actions
    ArrowLeft, ArrowLeftToLine, ArrowDown01, ArrowDown10, ArrowUp01, ArrowUp10,
    ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
    RotateCcw, RefreshCw, Repeat, LocateFixed, Locate, Home,

    // Interface
    X, XCircle, Check, CheckCircle, CheckCircle2, Circle,
    Plus, PlusCircle, Minus, Move, Maximize2, Link,
    Eye, EyeOff, Lock, LogIn, LogOut,
    Settings, LayoutDashboard, LayoutGrid, List, ListChecks, ListTodo,
    Search, Filter,

    // Fichiers & données
    File, FilePlus, FileDown, FileText, FolderDown, FolderOpen,
    Download, DownloadCloud, Upload, UploadCloud, CloudUpload,
    Database, HardDrive, Save, Copy, Send, Trash, Trash2,

    // Carte & circuit
    Map, MapPin, MapPinOff, MapPinPlus, Route, Globe,

    // Médias
    Camera, Image, ImageOff, ImagePlus, ImageDown, ImageUp,
    Mic, MicOff, Volume2, Play,

    // Sécurité & statut
    ShieldAlert, ShieldCheck, ShieldOff, ShieldX,
    AlertTriangle, Info, Bug, Key, KeyRound,
    Loader2, LoaderCircle,

    // Communication
    Mail, Github, QrCode, ScanLine, ScanEye, Smartphone, WifiOff,

    // Badges & gamification
    Award, Trophy, Star, Rocket, Sparkles, Zap, Crown,
    Bird, Flame, Snowflake, PawPrint, Mountain, Dog, Sprout, Feather, Footprints,

    // Catégories POI (map.js iconMap)
    CircleHelp, Hotel, CarTaxiFront,

    // UI & layout
    Pencil, Edit3, Printer, Palette, Languages, Paperclip,
    Clock, Calendar, CalendarCheck, CalendarOff, CalendarArrowUp, CalendarArrowDown,
    CalendarClock, Phone, Bookmark, Landmark, Wrench, DoorOpen,
    Ticket, Table, Package, PackageCheck, Server, ServerCog,
    Luggage, Heart, Coffee, Utensils, Ruler,

} from 'lucide';

export { createIcons };

export const appIcons = {
    ArrowLeft, ArrowLeftToLine, ArrowDown01, ArrowDown10, ArrowUp01, ArrowUp10,
    ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
    RotateCcw, RefreshCw, Repeat, LocateFixed, Locate, Home,

    X, XCircle, Check, CheckCircle, CheckCircle2, Circle,
    Plus, PlusCircle, Minus, Move, Maximize2, Link,
    Eye, EyeOff, Lock, LogIn, LogOut,
    Settings, LayoutDashboard, LayoutGrid, List, ListChecks, ListTodo,
    Search, Filter,

    File, FilePlus, FileDown, FileText, FolderDown, FolderOpen,
    Download, DownloadCloud, Upload, UploadCloud, CloudUpload,
    Database, HardDrive, Save, Copy, Send, Trash, Trash2,

    Map, MapPin, MapPinOff, MapPinPlus, Route, Globe,

    Camera, Image, ImageOff, ImagePlus, ImageDown, ImageUp,
    Mic, MicOff, Volume2, Play,

    ShieldAlert, ShieldCheck, ShieldOff, ShieldX,
    AlertTriangle, Info, Bug, Key, KeyRound,
    Loader2, LoaderCircle,

    Mail, Github, QrCode, ScanLine, ScanEye, Smartphone, WifiOff,

    Award, Trophy, Star, Rocket, Sparkles, Zap, Crown,
    Bird, Flame, Snowflake, PawPrint, Mountain, Dog, Sprout, Feather, Footprints,

    CircleHelp, Hotel, CarTaxiFront,

    Pencil, Edit3, Printer, Palette, Languages, Paperclip,
    Clock, Calendar, CalendarCheck, CalendarOff, CalendarArrowUp, CalendarArrowDown,
    CalendarClock, Phone, Bookmark, Landmark, Wrench, DoorOpen,
    Ticket, Table, Package, PackageCheck, Server, ServerCog,
    Luggage, Heart, Coffee, Utensils, Ruler,
};
